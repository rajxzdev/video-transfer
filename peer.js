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

        this._start();
    }

    _makeId() {
        var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var s = '';
        for (var i = 0; i < 6; i++) {
            s += c.charAt(Math.floor(Math.random() * c.length));
        }
        return 'G' + s;
    }

    _start() {
        // Clear any stuck old data
        var old = localStorage.getItem('gt_id2');
        var id = old || this._makeId();

        if (this.onStatus) this.onStatus('connecting');

        this._tryConnect(id, 0);
    }

    _tryConnect(id, attempt) {
        var self = this;

        if (attempt > 3) {
            // After 3 fails, new ID
            id = self._makeId();
            attempt = 0;
        }

        if (self.peer) {
            try { self.peer.destroy(); } catch(e) {}
            self.peer = null;
        }

        self._ready = false;

        console.log('Attempt ' + (attempt+1) + ' with ID: ' + id);

        if (self.onStatus) self.onStatus('connecting');

        var p;
        try {
            p = new Peer(id, {
                debug: 1,
                config: {
                    iceServers: [
                        {urls: 'stun:stun.l.google.com:19302'},
                        {urls: 'stun:stun1.l.google.com:19302'}
                    ]
                }
            });
        } catch(e) {
            console.error('Create fail:', e);
            setTimeout(function() {
                self._tryConnect(self._makeId(), 0);
            }, 3000);
            return;
        }

        self.peer = p;

        // 12 second timeout
        var timeout = setTimeout(function() {
            if (!self._ready) {
                console.warn('Timeout, retry...');
                try { p.destroy(); } catch(e) {}
                self._tryConnect(self._makeId(), attempt + 1);
            }
        }, 12000);

        p.on('open', function(openId) {
            clearTimeout(timeout);
            self._ready = true;
            self.myId = openId;
            localStorage.setItem('gt_id2', openId);
            if (self.onStatus) self.onStatus('online');
            if (self.onReady) self.onReady(openId);
            console.log('READY: ' + openId);
        });

        p.on('connection', function(conn) {
            self._incoming(conn);
        });

        p.on('error', function(err) {
            clearTimeout(timeout);
            console.error('PeerError:', err.type, err.message);

            if (err.type === 'unavailable-id') {
                var nid = self._makeId();
                localStorage.setItem('gt_id2', nid);
                setTimeout(function() { self._tryConnect(nid, 0); }, 1000);
            }
            else if (err.type === 'peer-unavailable') {
                if (self.onError) self.onError({message: 'Device not found or offline'});
            }
            else if (!self._ready) {
                setTimeout(function() {
                    self._tryConnect(self._makeId(), attempt + 1);
                }, 2000);
            }
            else {
                if (self.onError) self.onError({message: err.message || 'Error'});
            }
        });

        p.on('disconnected', function() {
            if (self.onStatus) self.onStatus('reconnecting');
            setTimeout(function() {
                if (self.peer && !self.peer.destroyed) {
                    try {
                        self.peer.reconnect();
                    } catch(e) {
                        self._tryConnect(localStorage.getItem('gt_id2') || self._makeId(), 0);
                    }
                }
            }, 3000);
        });
    }

    connect(peerId) {
        var self = this;

        if (!self._ready) {
            if (self.onError) self.onError({message: 'Still connecting, wait...'});
            return;
        }
        if (peerId === self.myId) {
            if (self.onError) self.onError({message: "Can't connect to yourself"});
            return;
        }
        if (self.conns.has(peerId)) {
            if (self.onError) self.onError({message: 'Already connected'});
            return;
        }

        var trusted = self.saved.some(function(d) { return d.id === peerId; });

        var conn;
        try {
            conn = self.peer.connect(peerId, {
                reliable: true,
                serialization: 'none'
            });
        } catch(e) {
            if (self.onError) self.onError({message: 'Connect failed'});
            return;
        }

        self.pending.set(peerId, conn);

        conn.on('open', function() {
            conn.send(JSON.stringify({type:'pair-req', from:self.myId, trusted:trusted}));
        });
        conn.on('data', function(d) { self._data(conn, peerId, d); });
        conn.on('close', function() {
            self.conns.delete(peerId);
            self.pending.delete(peerId);
            if (self.onDisconnected) self.onDisconnected(peerId);
        });
        conn.on('error', function(e) {
            if (self.onError) self.onError({message:'Connection failed'});
        });
    }

    _incoming(conn) {
        var self = this;
        var pid = conn.peer;
        conn.on('data', function(d) { self._data(conn, pid, d); });
        conn.on('close', function() {
            self.conns.delete(pid);
            if (self.onDisconnected) self.onDisconnected(pid);
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
        var self = this;
        switch(m.type) {
            case 'pair-req':
                var trusted = self.saved.some(function(d){return d.id===pid;});
                if (trusted || m.trusted) {
                    self._accept(conn, pid);
                } else {
                    self.pending.set(pid, conn);
                    if (self.onPairRequest) self.onPairRequest(pid);
                }
                break;
            case 'pair-ok':
                self.conns.set(pid, conn);
                self.pending.delete(pid);
                if (self.onPairAccepted) self.onPairAccepted(pid);
                break;
            case 'pair-no':
                self.pending.delete(pid);
                try{conn.close();}catch(e){}
                if (self.onPairRejected) self.onPairRejected(pid);
                break;
            case 'file-start':
                self.receiving.set(m.fid, {
                    name:m.name, size:m.size, mime:m.mime,
                    chunks:[], got:0, total:m.total
                });
                if (self.onFileStart) self.onFileStart(m);
                break;
            case 'file-end':
                var f = self.receiving.get(m.fid);
                if (f) {
                    var blob = new Blob(f.chunks, {type:f.mime});
                    if (self.onFileComplete) self.onFileComplete({
                        fid:m.fid, name:f.name, size:f.size,
                        mime:f.mime, blob:blob, from:pid
                    });
                    self.receiving.delete(m.fid);
                }
                break;
        }
    }

    _chunk(pid, buf) {
        var self = this;
        self.receiving.forEach(function(f, fid) {
            if (f.got < f.total) {
                f.chunks.push(buf);
                f.got++;
                if (self.onProgress) {
                    self.onProgress({
                        fid:fid, name:f.name,
                        done:f.got, total:f.total,
                        pct:Math.round(f.got/f.total*100),
                        sending:false
                    });
                }
                return;
            }
        });
    }

    acceptPair(pid) {
        var conn = this.pending.get(pid);
        if (conn) this._accept(conn, pid);
    }

    _accept(conn, pid) {
        this.conns.set(pid, conn);
        this.pending.delete(pid);
        conn.send(JSON.stringify({type:'pair-ok', from:this.myId}));
        if (this.onConnected) this.onConnected(pid);
    }

    rejectPair(pid) {
        var conn = this.pending.get(pid);
        if (conn) {
            conn.send(JSON.stringify({type:'pair-no'}));
            setTimeout(function(){try{conn.close();}catch(e){}}, 300);
        }
        this.pending.delete(pid);
    }

    sendFiles(pid, files) {
        var self = this;
        var conn = self.conns.get(pid);
        if (!conn) return Promise.reject(new Error('Not connected'));

        var i = 0;
        function doNext() {
            if (i >= files.length) return Promise.resolve();
            var idx = i;
            i++;
            return self._send(conn, files[idx], idx).then(doNext);
        }
        return doNext();
    }

    _send(conn, file, idx) {
        var self = this;
        return new Promise(function(resolve, reject) {
            var fid = 'f' + Date.now() + '_' + idx;
            var total = Math.ceil(file.size / self.CHUNK);

            conn.send(JSON.stringify({
                type:'file-start', fid:fid,
                name:file.name, size:file.size,
                mime:file.type, total:total
            }));

            var off = 0;
            var sent = 0;

            function next() {
                if (off >= file.size) {
                    setTimeout(function() {
                        conn.send(JSON.stringify({type:'file-end', fid:fid}));
                        resolve();
                    }, 250);
                    return;
                }

                var slice = file.slice(off, off + self.CHUNK);
                var r = new FileReader();
                r.onload = function(e) {
                    try { conn.send(e.target.result); } catch(err) { reject(err); return; }
                    sent++;
                    off += self.CHUNK;

                    if (self.onProgress) {
                        self.onProgress({
                            fid:fid, name:file.name, idx:idx,
                            done:sent, total:total,
                            pct:Math.round(sent/total*100),
                            sending:true
                        });
                    }

                    setTimeout(next, 3);
                };
                r.onerror = function() { reject(new Error('Read error')); };
                r.readAsArrayBuffer(slice);
            }

            setTimeout(next, 250);
        });
    }

    saveDevice(pid) {
        var exists = false;
        for (var i=0;i<this.saved.length;i++) {
            if (this.saved[i].id===pid) {exists=true;break;}
        }
        if (!exists) {
            this.saved.push({id:pid, name:'Device '+(this.saved.length+1), ts:Date.now()});
            this._save();
        }
    }
    removeDevice(pid) {
        this.saved = this.saved.filter(function(d){return d.id!==pid;});
        this._save();
    }
    _loadDevices() {
        try{return JSON.parse(localStorage.getItem('gt_devs')||'[]');}catch(e){return[];}
    }
    _save() {
        localStorage.setItem('gt_devs', JSON.stringify(this.saved));
    }
    peers() { return Array.from(this.conns.keys()); }
    isConn(pid) { return this.conns.has(pid); }
    disconnect(pid) {
        var c=this.conns.get(pid);
        if(c)try{c.close();}catch(e){}
        this.conns.delete(pid);
    }
}
