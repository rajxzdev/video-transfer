class GalaxyPeer {
    constructor() {
        this.peer = null;
        this.myId = null;
        this.conns = new Map();
        this.pending = new Map();
        this.saved = this._loadDevices();
        this.receiving = new Map();
        this.CHUNK = 64 * 1024;
        this._ready = false;
        this._attempt = 0;

        this.onReady = null;
        this.onStatus = null;
        this.onPairRequest = null;
        this.onConnected = null;
        this.onDisconnected = null;
        this.onPairAccepted = null;
        this.onPairRejected = null;
        this.onFileStart = null;
        this.onProgress = null;
        this.onFileComplete = null;
        this.onError = null;

        this._boot();
    }

    _genId() {
        const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = '';
        for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
        return 'GT' + s;
    }

    _boot() {
        // Always start fresh ID on first load if none saved
        let id = localStorage.getItem('gt_id');
        if (!id) {
            id = this._genId();
            localStorage.setItem('gt_id', id);
        }
        this._attempt = 0;
        this._connect(id);
    }

    _connect(id) {
        this._attempt++;
        if (this._attempt > 8) {
            // Give up with this ID, make new one
            id = this._genId();
            localStorage.setItem('gt_id', id);
            this._attempt = 1;
        }

        if (this.peer) {
            try { this.peer.destroy(); } catch(e) {}
            this.peer = null;
        }

        this._ready = false;
        if (this.onStatus) this.onStatus('connecting');

        try {
            // Use default PeerJS cloud server with NO custom config issues
            this.peer = new Peer(id, {
                debug: 0,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                    ]
                }
            });
        } catch(e) {
            console.error('Peer create fail:', e);
            setTimeout(() => this._connect(this._genId()), 2000);
            return;
        }

        // Timeout: if not open in 10s, retry with new ID
        const timer = setTimeout(() => {
            if (!this._ready) {
                console.warn('Timeout, retrying...');
                const newId = this._genId();
                localStorage.setItem('gt_id', newId);
                this._connect(newId);
            }
        }, 10000);

        this.peer.on('open', (openId) => {
            clearTimeout(timer);
            this._ready = true;
            this._attempt = 0;
            this.myId = openId;
            localStorage.setItem('gt_id', openId);
            if (this.onStatus) this.onStatus('online');
            if (this.onReady) this.onReady(openId);
            console.log('Peer ready:', openId);
        });

        this.peer.on('connection', (conn) => this._incoming(conn));

        this.peer.on('error', (err) => {
            clearTimeout(timer);
            console.error('Peer error:', err.type, err);

            if (err.type === 'unavailable-id') {
                const newId = this._genId();
                localStorage.setItem('gt_id', newId);
                setTimeout(() => this._connect(newId), 500);
            } else if (err.type === 'peer-unavailable') {
                if (this.onError) this.onError({ message: 'Device not found or offline' });
            } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                if (this.onStatus) this.onStatus('reconnecting');
                setTimeout(() => {
                    this._connect(localStorage.getItem('gt_id') || this._genId());
                }, 2000 * this._attempt);
            } else {
                if (this.onError) this.onError({ message: err.type + ': ' + (err.message || '') });
            }
        });

        this.peer.on('disconnected', () => {
            if (this._ready) {
                if (this.onStatus) this.onStatus('reconnecting');
                setTimeout(() => {
                    if (this.peer && !this.peer.destroyed) {
                        try { this.peer.reconnect(); } catch(e) {
                            this._connect(localStorage.getItem('gt_id') || this._genId());
                        }
                    }
                }, 2000);
            }
        });
    }

    // ===== CONNECTION HANDLING =====
    connect(peerId) {
        if (!this._ready) {
            if (this.onError) this.onError({ message: 'Still connecting to network, please wait...' });
            return;
        }
        if (peerId === this.myId) {
            if (this.onError) this.onError({ message: "Can't connect to yourself" });
            return;
        }
        if (this.conns.has(peerId)) {
            if (this.onError) this.onError({ message: 'Already connected' });
            return;
        }

        const trusted = this.saved.some(d => d.id === peerId);

        const conn = this.peer.connect(peerId, {
            reliable: true,
            serialization: 'none'
        });

        this.pending.set(peerId, conn);

        conn.on('open', () => {
            conn.send(JSON.stringify({ type: 'pair-req', from: this.myId, trusted }));
        });
        conn.on('data', d => this._data(conn, peerId, d));
        conn.on('close', () => {
            this.conns.delete(peerId);
            this.pending.delete(peerId);
            if (this.onDisconnected) this.onDisconnected(peerId);
        });
        conn.on('error', e => {
            console.error('conn error:', e);
            if (this.onError) this.onError({ message: 'Connection to device failed' });
        });
    }

    _incoming(conn) {
        const pid = conn.peer;
        conn.on('data', d => this._data(conn, pid, d));
        conn.on('close', () => {
            this.conns.delete(pid);
            if (this.onDisconnected) this.onDisconnected(pid);
        });
    }

    _data(conn, pid, data) {
        if (typeof data === 'string') {
            try { this._msg(conn, pid, JSON.parse(data)); } catch(e) {}
        } else if (data instanceof ArrayBuffer) {
            this._chunk(pid, data);
        }
    }

    _msg(conn, pid, m) {
        switch(m.type) {
            case 'pair-req': {
                const trusted = this.saved.some(d => d.id === pid);
                if (trusted || m.trusted) {
                    this._accept(conn, pid);
                } else {
                    this.pending.set(pid, conn);
                    if (this.onPairRequest) this.onPairRequest(pid);
                }
                break;
            }
            case 'pair-ok':
                this.conns.set(pid, conn);
                this.pending.delete(pid);
                if (this.onPairAccepted) this.onPairAccepted(pid);
                break;
            case 'pair-no':
                this.pending.delete(pid);
                try { conn.close(); } catch(e) {}
                if (this.onPairRejected) this.onPairRejected(pid);
                break;
            case 'file-start':
                this.receiving.set(m.fid, {
                    name: m.name, size: m.size, mime: m.mime,
                    chunks: [], got: 0, total: m.total
                });
                if (this.onFileStart) this.onFileStart(m);
                break;
            case 'file-end': {
                const f = this.receiving.get(m.fid);
                if (f) {
                    const blob = new Blob(f.chunks, { type: f.mime });
                    if (this.onFileComplete) this.onFileComplete({
                        fid: m.fid, name: f.name, size: f.size,
                        mime: f.mime, blob, from: pid
                    });
                    this.receiving.delete(m.fid);
                }
                break;
            }
        }
    }

    _chunk(pid, buf) {
        for (const [fid, f] of this.receiving) {
            if (f.got < f.total) {
                f.chunks.push(buf);
                f.got++;
                if (this.onProgress) {
                    this.onProgress({
                        fid, name: f.name,
                        done: f.got, total: f.total,
                        pct: Math.round(f.got / f.total * 100),
                        sending: false
                    });
                }
                break;
            }
        }
    }

    acceptPair(pid) {
        const conn = this.pending.get(pid);
        if (conn) this._accept(conn, pid);
    }

    _accept(conn, pid) {
        this.conns.set(pid, conn);
        this.pending.delete(pid);
        conn.send(JSON.stringify({ type: 'pair-ok', from: this.myId }));
        if (this.onConnected) this.onConnected(pid);
    }

    rejectPair(pid) {
        const conn = this.pending.get(pid);
        if (conn) {
            conn.send(JSON.stringify({ type: 'pair-no' }));
            setTimeout(() => { try { conn.close(); } catch(e) {} }, 300);
        }
        this.pending.delete(pid);
    }

    // ===== FILE TRANSFER =====
    async sendFiles(pid, files) {
        const conn = this.conns.get(pid);
        if (!conn) throw new Error('Not connected to device');
        for (let i = 0; i < files.length; i++) {
            await this._send(conn, files[i], i);
        }
    }

    _send(conn, file, idx) {
        return new Promise((resolve, reject) => {
            const fid = 'f' + Date.now() + '_' + idx;
            const total = Math.ceil(file.size / this.CHUNK);

            conn.send(JSON.stringify({
                type: 'file-start', fid,
                name: file.name, size: file.size,
                mime: file.type, total
            }));

            let off = 0, sent = 0;

            const next = () => {
                if (off >= file.size) {
                    // Small delay to ensure last chunk is processed
                    setTimeout(() => {
                        conn.send(JSON.stringify({ type: 'file-end', fid }));
                        resolve();
                    }, 200);
                    return;
                }

                const blob = file.slice(off, off + this.CHUNK);
                const r = new FileReader();
                r.onload = e => {
                    try { conn.send(e.target.result); } catch(err) { reject(err); return; }
                    sent++;
                    off += this.CHUNK;

                    if (this.onProgress) {
                        this.onProgress({
                            fid, name: file.name, idx,
                            done: sent, total,
                            pct: Math.round(sent / total * 100),
                            sending: true
                        });
                    }

                    // Simple back-pressure
                    const wait = () => {
                        try {
                            // Check DataChannel buffer
                            const dc = conn.dataChannel || (conn.peerConnection && conn.peerConnection.sctp);
                            const bufSize = conn.bufferSize || (dc && dc.bufferedAmount) || 0;
                            if (bufSize > 2 * 1024 * 1024) {
                                setTimeout(wait, 50);
                                return;
                            }
                        } catch(e) {}
                        setTimeout(next, 1);
                    };
                    wait();
                };
                r.onerror = () => reject(new Error('File read error'));
                r.readAsArrayBuffer(blob);
            };

            setTimeout(next, 200);
        });
    }

    // ===== DEVICE STORAGE =====
    saveDevice(pid) {
        if (!this.saved.some(d => d.id === pid)) {
            this.saved.push({ id: pid, name: 'Device ' + (this.saved.length + 1), ts: Date.now() });
            this._save();
        }
    }
    removeDevice(pid) {
        this.saved = this.saved.filter(d => d.id !== pid);
        this._save();
    }
    _loadDevices() {
        try { return JSON.parse(localStorage.getItem('gt_devs') || '[]'); } catch { return []; }
    }
    _save() { localStorage.setItem('gt_devs', JSON.stringify(this.saved)); }

    peers() { return [...this.conns.keys()]; }
    isConn(pid) { return this.conns.has(pid); }
    disconnect(pid) {
        const c = this.conns.get(pid);
        if (c) try { c.close(); } catch(e) {}
        this.conns.delete(pid);
    }
}
