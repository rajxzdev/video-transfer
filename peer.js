/**
 * Galaxy Transfer - PeerConnection Manager
 * Handles WebRTC peer connections, pairing, and data transfer
 */
class PeerManager {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection
        this.myId = null;
        this.savedDevices = this.loadSavedDevices();
        this.pendingPairRequests = new Map();

        // Callbacks
        this.onReady = null;
        this.onPeerConnected = null;
        this.onPeerDisconnected = null;
        this.onPairRequest = null;
        this.onPairAccepted = null;
        this.onPairRejected = null;
        this.onFileStart = null;
        this.onFileChunk = null;
        this.onFileComplete = null;
        this.onTransferProgress = null;
        this.onError = null;

        this.CHUNK_SIZE = 64 * 1024; // 64KB chunks
        this.receivingFiles = new Map();

        this.init();
    }

    init() {
        const savedId = localStorage.getItem('galaxy_device_id');
        const peerId = savedId || 'GT-' + this.generateId();

        this.peer = new Peer(peerId, {
            debug: 0,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    {
                        urls: 'turn:openrelay.metered.ca:80',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ]
            }
        });

        this.peer.on('open', (id) => {
            this.myId = id;
            localStorage.setItem('galaxy_device_id', id);
            if (this.onReady) this.onReady(id);
        });

        this.peer.on('connection', (conn) => {
            this.handleIncomingConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('Peer error:', err);
            if (err.type === 'unavailable-id') {
                localStorage.removeItem('galaxy_device_id');
                const newId = 'GT-' + this.generateId();
                this.peer = new Peer(newId);
                this.peer.on('open', (id) => {
                    this.myId = id;
                    localStorage.setItem('galaxy_device_id', id);
                    if (this.onReady) this.onReady(id);
                });
                this.peer.on('connection', (conn) => {
                    this.handleIncomingConnection(conn);
                });
            }
            if (this.onError) this.onError(err);
        });

        this.peer.on('disconnected', () => {
            setTimeout(() => {
                if (this.peer && !this.peer.destroyed) {
                    this.peer.reconnect();
                }
            }, 3000);
        });
    }

    generateId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    connectToPeer(peerId) {
        if (this.connections.has(peerId)) {
            if (this.onError) this.onError({ type: 'already-connected', message: 'Already connected to this device' });
            return;
        }

        // Check if this is a saved/trusted device
        const isTrusted = this.savedDevices.some(d => d.id === peerId);

        const conn = this.peer.connect(peerId, {
            reliable: true,
            serialization: 'none',
            metadata: {
                type: 'pair-request',
                fromId: this.myId,
                trusted: isTrusted
            }
        });

        conn.on('open', () => {
            // Send pair request message
            const msg = JSON.stringify({
                type: 'pair-request',
                fromId: this.myId,
                trusted: isTrusted
            });
            conn.send(msg);
        });

        conn.on('data', (data) => {
            this.handleData(conn, peerId, data);
        });

        conn.on('close', () => {
            this.connections.delete(peerId);
            if (this.onPeerDisconnected) this.onPeerDisconnected(peerId);
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            if (this.onError) this.onError(err);
        });

        // Store temporarily
        this.pendingPairRequests.set(peerId, conn);
    }

    handleIncomingConnection(conn) {
        const peerId = conn.peer;

        conn.on('open', () => {
            // Wait for pair request message
        });

        conn.on('data', (data) => {
            this.handleData(conn, peerId, data);
        });

        conn.on('close', () => {
            this.connections.delete(peerId);
            if (this.onPeerDisconnected) this.onPeerDisconnected(peerId);
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
        });
    }

    handleData(conn, peerId, data) {
        // Check if it's a string message (control messages)
        if (typeof data === 'string') {
            try {
                const msg = JSON.parse(data);
                this.handleControlMessage(conn, peerId, msg);
            } catch (e) {
                // Not JSON, ignore
            }
        } else if (data instanceof ArrayBuffer) {
            // Binary data - file chunk
            this.handleFileChunk(peerId, data);
        }
    }

    handleControlMessage(conn, peerId, msg) {
        switch (msg.type) {
            case 'pair-request': {
                // Check if this device is trusted
                const isTrusted = this.savedDevices.some(d => d.id === peerId);
                if (isTrusted || msg.trusted) {
                    // Auto accept trusted devices
                    this.acceptPair(conn, peerId);
                } else {
                    // Show pair request to user
                    this.pendingPairRequests.set(peerId, conn);
                    if (this.onPairRequest) this.onPairRequest(peerId, conn);
                }
                break;
            }
            case 'pair-accepted': {
                this.connections.set(peerId, conn);
                this.pendingPairRequests.delete(peerId);
                if (this.onPairAccepted) this.onPairAccepted(peerId);
                break;
            }
            case 'pair-rejected': {
                this.pendingPairRequests.delete(peerId);
                conn.close();
                if (this.onPairRejected) this.onPairRejected(peerId);
                break;
            }
            case 'file-start': {
                this.receivingFiles.set(msg.fileId, {
                    name: msg.name,
                    size: msg.size,
                    type: msg.mimeType,
                    chunks: [],
                    received: 0,
                    totalChunks: msg.totalChunks
                });
                if (this.onFileStart) this.onFileStart(msg);
                break;
            }
            case 'file-chunk-info': {
                // Next chunk is binary
                const fileData = this.receivingFiles.get(msg.fileId);
                if (fileData) {
                    fileData._nextChunkIndex = msg.chunkIndex;
                }
                break;
            }
            case 'file-complete': {
                const fileInfo = this.receivingFiles.get(msg.fileId);
                if (fileInfo) {
                    const blob = new Blob(fileInfo.chunks, { type: fileInfo.type });
                    if (this.onFileComplete) this.onFileComplete({
                        fileId: msg.fileId,
                        name: fileInfo.name,
                        size: fileInfo.size,
                        type: fileInfo.type,
                        blob: blob,
                        from: peerId
                    });
                    this.receivingFiles.delete(msg.fileId);
                }
                break;
            }
            case 'all-transfers-complete': {
                // All files done
                break;
            }
        }
    }

    handleFileChunk(peerId, data) {
        // Find which file this chunk belongs to (latest active receive)
        for (const [fileId, fileData] of this.receivingFiles) {
            if (fileData.received < fileData.totalChunks) {
                fileData.chunks.push(data);
                fileData.received++;

                if (this.onTransferProgress) {
                    this.onTransferProgress({
                        fileId: fileId,
                        name: fileData.name,
                        received: fileData.received,
                        total: fileData.totalChunks,
                        percent: Math.round((fileData.received / fileData.totalChunks) * 100)
                    });
                }
                break;
            }
        }
    }

    acceptPair(conn, peerId) {
        this.connections.set(peerId, conn);
        this.pendingPairRequests.delete(peerId);

        const msg = JSON.stringify({
            type: 'pair-accepted',
            fromId: this.myId
        });
        conn.send(msg);

        if (this.onPeerConnected) this.onPeerConnected(peerId);
    }

    rejectPair(peerId) {
        const conn = this.pendingPairRequests.get(peerId);
        if (conn) {
            const msg = JSON.stringify({
                type: 'pair-rejected',
                fromId: this.myId
            });
            conn.send(msg);
            setTimeout(() => conn.close(), 500);
        }
        this.pendingPairRequests.delete(peerId);
    }

    async sendFiles(peerId, files) {
        const conn = this.connections.get(peerId);
        if (!conn) {
            if (this.onError) this.onError({ message: 'Not connected to this device' });
            return;
        }

        for (let i = 0; i < files.length; i++) {
            await this.sendFile(conn, files[i], i);
        }

        conn.send(JSON.stringify({ type: 'all-transfers-complete' }));
    }

    sendFile(conn, file, index) {
        return new Promise((resolve) => {
            const fileId = 'f_' + Date.now() + '_' + index;
            const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);

            // Send file metadata
            conn.send(JSON.stringify({
                type: 'file-start',
                fileId: fileId,
                name: file.name,
                size: file.size,
                mimeType: file.type,
                totalChunks: totalChunks
            }));

            let offset = 0;
            let chunkIndex = 0;

            const sendNextChunk = () => {
                if (offset >= file.size) {
                    conn.send(JSON.stringify({
                        type: 'file-complete',
                        fileId: fileId
                    }));
                    resolve();
                    return;
                }

                const slice = file.slice(offset, offset + this.CHUNK_SIZE);
                const reader = new FileReader();

                reader.onload = (e) => {
                    try {
                        conn.send(e.target.result);
                    } catch (err) {
                        console.error('Send chunk error:', err);
                    }

                    chunkIndex++;
                    offset += this.CHUNK_SIZE;

                    if (this.onTransferProgress) {
                        this.onTransferProgress({
                            fileId: fileId,
                            name: file.name,
                            sent: chunkIndex,
                            total: totalChunks,
                            percent: Math.round((chunkIndex / totalChunks) * 100),
                            isSending: true
                        });
                    }

                    // Throttle to prevent buffer overflow
                    if (conn.bufferSize > 8 * 1024 * 1024) {
                        const checkBuffer = setInterval(() => {
                            if (conn.bufferSize < 2 * 1024 * 1024) {
                                clearInterval(checkBuffer);
                                sendNextChunk();
                            }
                        }, 100);
                    } else {
                        setTimeout(sendNextChunk, 5);
                    }
                };

                reader.readAsArrayBuffer(slice);
            };

            // Small delay to ensure metadata is sent first
            setTimeout(sendNextChunk, 100);
        });
    }

    // Device management
    saveDevice(peerId, name) {
        const existing = this.savedDevices.find(d => d.id === peerId);
        if (!existing) {
            this.savedDevices.push({
                id: peerId,
                name: name || `Device ${this.savedDevices.length + 1}`,
                savedAt: Date.now()
            });
            this.persistSavedDevices();
        }
    }

    removeDevice(peerId) {
        this.savedDevices = this.savedDevices.filter(d => d.id !== peerId);
        this.persistSavedDevices();
    }

    loadSavedDevices() {
        try {
            return JSON.parse(localStorage.getItem('galaxy_saved_devices') || '[]');
        } catch {
            return [];
        }
    }

    persistSavedDevices() {
        localStorage.setItem('galaxy_saved_devices', JSON.stringify(this.savedDevices));
    }

    getConnectedPeers() {
        return Array.from(this.connections.keys());
    }

    isConnected(peerId) {
        return this.connections.has(peerId);
    }

    disconnect(peerId) {
        const conn = this.connections.get(peerId);
        if (conn) conn.close();
        this.connections.delete(peerId);
    }

    destroy() {
        if (this.peer) this.peer.destroy();
    }
          }
