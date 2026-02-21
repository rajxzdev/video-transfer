/**
 * Galaxy Transfer - Peer Connection Manager
 * Fixed: reliable connection, proper ID generation, multi-server fallback
 */
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
        this._retries = 0;

        // callbacks
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

        this._init();
    }

    _genId() {
        const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = '';
        const arr = new Uint8Array(6);
        crypto.getRandomValues(arr);
        for (let i = 0; i < 6; i++) s += c[arr[i] % c.length];
        return 'GT-' + s;
    }

    _init() {
        let id = localStorage.getItem('gt_myid');
        if (!id) {
            id = this._genId();
            localStorage.setItem('gt_myid', id);
        }
        this._createPeer(id);
    }

    _createPeer(id) {
        if (this.peer) {
            try { this.peer.destroy(); } catch(e) {}
        }

        this._setStatus('connecting');

        // Use multiple PeerJS servers for reliability
        const servers = [
            { host: '0.peerjs.com', port: 443, secure: true, path: '/' },
            { host: 'peerjs-server.herokuapp.com', port: 443, secure: true, path: '/' },
        ];

        const cfg = {
            debug: 0,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                ]
            }
        };

        try {
            this.peer = new Peer(id, cfg);
        } catch(e) {
            this._fallbackInit();
            return;
        }

        const timeout = setTimeout(() => {
            if (!this._ready) {
                console.warn('PeerJS open timeout, retrying...');
                this._retry();
            }
        }, 8000);

        this.peer.on('open', (openId) => {
            clearTimeout(timeout);
            this._ready = true;
            this._retries = 0;
            this.myId = openId;
            localStorage.setItem('gt_myid', openId);
            this._setStatus('online');
            if (this.onReady) this.onReady(openId);
        });

        this.peer.on('connection', (conn) => this._onIncoming(conn));

        this.peer.on('error', (err) => {
            clearTimeout(timeout);
            console.error('PeerJS error:', err.type, err.message);

            if (err.type === 'unavailable-id') {
                const newId = this._genId();
                localStorage.setItem('gt_myid', newId);
                this._ready = false;
                setTimeout(() => this._createPeer(newId), 500);
            } else if (err.type === 'server-error' || err.type === 'network' || err.type === 'socket-error') {
                this._retry();
            } else if (err.type === 'peer-unavailable') {
                if (this.onError) this.onError({ message: 'Device not found or offline' });
            } else {
                if (this.onError) this.onError({ message: err.message || 'Connection error' });
            }
        });

        this.peer.on('disconnected', () => {
            this._setStatus('reconnecting');
            setTimeout(() => {
                if (this.peer && !this.peer.destroyed) {
                    try { this.peer.reconnect(); } catch(e) { this._retry(); }
                }
            }, 2000);
        });

        this.peer.on('close', () => {
            this._ready = false;
            this._setStatus('offline');
        });
    }

    _retry() {
        this._retries++;
        if (this._retries > 5) {
            this._fallbackInit();
            return;
        }
        this._ready = false;
        const delay = Math.min(1000 * this._retries, 5000);
        this._setStatus('reconnecting');
        setTimeout(() => {
            const id = localStorage.getItem('gt_myid') || this._genId();
            this._createPeer(id);
        }, delay);
    }

    _fallbackInit() {
        // Generate new ID and try fresh
        const id = this._genId();
        localStorage.setItem('gt_myid', id);
        this._retries = 0;
        this._setStatus('connecting');
        setTimeout(() => this._createPeer(id), 1000);
    }

    _setStatus(s) {
        if (this.onStatus) this.onStatus(s);
    }

    // ===== CONNECTIONS =====
    connect(peerId) {
        if (!this._ready || !this.peer) {
            if (this.onError) this.onError({ message: 'Not connected to network yet. Please wait.' });
            return;
        }
        if (this.conns.has(peerId)) {
            if (this.onError) this.onError({ message: 'Already connected to this device' });
            return;
        }
        if (peerId === this.myId) {
            if (this.onError) this.onError({ message: "Can't connect to yourself!" });
            return;
        }

        const trusted = this.saved.some(d => d.id === peerId);

        try {
            const conn = this.peer.connect(peerId, {
                reliable: true,
                serialization: 'none',
                metadata: { type: 'pair', from: this.myId, trusted }
            });

            this.pending.set(peerId, conn);

            conn.on('open', () => {
                conn.send(JSON.stringify({ type: 'pair-req', from: this.myId, trusted }));
            });

            conn.on('data', (d) => this._handle(conn, peerId, d));
            conn.on('close', () => {
                this.conns.delete(peerId);
                this.pending.delete(peerId);
                if (this.onDisconnected) this.onDisconnected(peerId);
            });
            conn.on('error', (e) => {
                console.error('Conn err:', e);
                if (this.onError) this.onError({ message: 'Connection failed' });
            });
        } catch(e) {
            if (this.onError) this.onError({ message: 'Failed to connect: ' + e.message });
        }
    }

    _onIncoming(conn) {
        const pid = conn.peer;
        conn.on('data', (d) => this._handle(conn, pid, d));
        conn.on('close', () => {
            this.conns.delete(pid);
            if (this.onDisconnected) this.onDisconnected(pid);
        });
        conn.on('error', (e) => console.error('Incoming err:', e));
    }

    _handle(conn, pid, data) {
        if (typeof data === 'string') {
            try {
                const m = JSON.parse(data);
                this._ctrl(conn, pid, m);
            } catch(e) {}
        } else if (data instanceof ArrayBuffer) {
            this._chunk(pid, data);
        }
    }

    _ctrl(conn, pid, m) {
        switch(m.type) {
            case 'pair-req': {
                const trusted = this.saved.some(d => d.id === pid);
                if (trusted || m.trusted) {
                    this._acceptPair(conn, pid);
                } else {
                    this.pending.set(pid, conn);
                    if (this.onPairRequest) this.onPairRequest(pid);
                }
                break;
            }
            case 'pair-ok': {
                this.conns.set(pid, conn);
                this.pending.delete(pid);
                if (this.onPairAccepted) this.onPairAccepted(pid);
                break;
            }
            case 'pair-no': {
                this.pending.delete(pid);
                try { conn.close(); } catch(e) {}
                if (this.onPairRejected) this.onPairRejected(pid);
                break;
            }
            case 'file-start': {
                this.receiving.set(m.fid, {
                    name: m.name, size: m.size, mime: m.mime,
                    chunks: [], got: 0, total: m.chunks
                });
                if (this.onFileStart) this.onFileStart(m);
                break;
            }
            case 'file-end': {
                const f = this.receiving.get(m.fid);
                if (f) {
                    const blob = new Blob(f.chunks, { type: f.mime });
                    if (this.onFileComplete) this.onFileComplete({
                        fid: m.fid, name: f.name, size: f.size, mime: f.mime, blob, from: pid
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
        if (conn) this._acceptPair(conn, pid);
    }

    _acceptPair(conn, pid) {
        this.conns.set(pid, conn);
        this.pending.delete(pid);
        conn.send(JSON.stringify({ type: 'pair-ok', from: this.myId }));
        if (this.onConnected) this.onConnected(pid);
    }

    rejectPair(pid) {
        const conn = this.pending.get(pid);
        if (conn) {
            conn.send(JSON.stringify({ type: 'pair-no', from: this.myId }));
            setTimeout(() => { try { conn.close(); } catch(e) {} }, 500);
        }
        this.pending.delete(pid);
    }

    // ===== TRANSFER =====
    async sendFiles(pid, files) {
        const conn = this.conns.get(pid);
        if (!conn) throw new Error('Not connected');
        for (let i = 0; i < files.length; i++) {
            await this._sendOne(conn, files[i], i);
        }
    }

    _sendOne(conn, file, idx) {
        return new Promise((resolve, reject) => {
            const fid = 'f' + Date.now() + '_' + idx;
            const total = Math.ceil(file.size / this.CHUNK);

            conn.send(JSON.stringify({
                type: 'file-start', fid, name: file.name,
                size: file.size, mime: file.type, chunks: total
            }));

            let offset = 0, sent = 0;

            const next = () => {
                if (offset >= file.size) {
                    conn.send(JSON.stringify({ type: 'file-end', fid }));
                    resolve();
                    return;
                }

                const slice = file.slice(offset, offset + this.CHUNK);
                const r = new FileReader();
                r.onload = (e) => {
                    try {
                        conn.send(e.target.result);
                    } catch(err) {
                        reject(err);
                        return;
                    }
                    sent++;
                    offset += this.CHUNK;

                    if (this.onProgress) {
                        this.onProgress({
                            fid, name: file.name,
                            done: sent, total,
                            pct: Math.round(sent / total * 100),
                            sending: true, idx
                        });
                    }

                    // Back-pressure handling
                    const checkSend = () => {
                        if (conn.bufferSize > 4 * 1024 * 1024) {
                            setTimeout(checkSend, 50);
                        } else {
                            setTimeout(next, 2);
                        }
                    };

                    if (conn.peerConnection) {
                        checkSend();
                    } else {
                        setTimeout(next, 5);
                    }
                };
                r.onerror = () => reject(new Error('Read error'));
                r.readAsArrayBuffer(slice);
            };

            setTimeout(next, 150);
        });
    }

    // ===== DEVICE MANAGEMENT =====
    saveDevice(pid) {
        if (!this.saved.some(d => d.id === pid)) {
            this.saved.push({ id: pid, name: 'Device ' + (this.saved.length + 1), ts: Date.now() });
            this._persist();
        }
    }

    removeDevice(pid) {
        this.saved = this.saved.filter(d => d.id !== pid);
        this._persist();
    }

    _loadDevices() {
        try { return JSON.parse(localStorage.getItem('gt_devs') || '[]'); } catch { return []; }
    }

    _persist() {
        localStorage.setItem('gt_devs', JSON.stringify(this.saved));
    }

    peers() { return [...this.conns.keys()]; }
    isConn(pid) { return this.conns.has(pid); }
    disconnect(pid) {
        const c = this.conns.get(pid);
        if (c) try { c.close(); } catch(e) {}
        this.conns.delete(pid);
    }
}
