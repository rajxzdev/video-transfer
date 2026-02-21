/**
 * Galaxy Transfer - Main Application
 */
(function () {
    'use strict';

    // ===== INITIALIZATION =====
    const pm = new PeerManager();
    let selectedFiles = [];
    let receivedVideos = [];

    // ===== DOM ELEMENTS =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ===== GENERATE STARS =====
    function generateStars() {
        const container = $('#stars');
        const count = 120;
        for (let i = 0; i < count; i++) {
            const star = document.createElement('div');
            star.className = 'star';
            star.style.left = Math.random() * 100 + '%';
            star.style.top = Math.random() * 100 + '%';
            star.style.setProperty('--dur', (2 + Math.random() * 4) + 's');
            star.style.setProperty('--opac', (0.3 + Math.random() * 0.7));
            star.style.animationDelay = Math.random() * 5 + 's';
            star.style.width = (1 + Math.random() * 2) + 'px';
            star.style.height = star.style.width;
            container.appendChild(star);
        }
    }
    generateStars();

    // ===== TOAST =====
    function showToast(message, type = 'info') {
        const container = $('#toastContainer');
        const icons = {
            success: '✅',
            error: '❌',
            info: '💜',
            warning: '⚠️'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ===== TAB NAVIGATION =====
    $$('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            $$('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            $$('.tab-content').forEach(t => t.classList.remove('active'));
            $(`#tab-${tab}`).classList.add('active');
            // Re-trigger animation
            $(`#tab-${tab}`).style.animation = 'none';
            $(`#tab-${tab}`).offsetHeight; // reflow
            $(`#tab-${tab}`).style.animation = '';
        });
    });

    // ===== PEER MANAGER CALLBACKS =====
    pm.onReady = (id) => {
        $('#myIdDisplay').textContent = id;
        $('.device-id-text').textContent = id;
        showToast('Device ready!', 'success');
    };

    pm.onPairRequest = (peerId) => {
        $('#pairRequestId').textContent = peerId;
        $('#pairModal').style.display = 'flex';
    };

    pm.onPairAccepted = (peerId) => {
        showToast(`Connected to ${peerId}`, 'success');
        pm.saveDevice(peerId, `Device`);
        updateConnectionStatus(peerId, true);
        updateDevicesList();
        updateTargetSelect();
    };

    pm.onPairRejected = (peerId) => {
        showToast('Connection rejected', 'error');
        updateConnectionStatus(peerId, false);
    };

    pm.onPeerConnected = (peerId) => {
        showToast(`Device ${peerId} connected`, 'success');
        pm.saveDevice(peerId, `Device`);
        updateConnectionStatus(peerId, true);
        updateDevicesList();
        updateTargetSelect();
    };

    pm.onPeerDisconnected = (peerId) => {
        showToast(`${peerId} disconnected`, 'warning');
        updateConnectionStatus(peerId, false);
        updateTargetSelect();
    };

    pm.onFileStart = (info) => {
        showToast(`Receiving: ${info.name}`, 'info');
        // Switch to receive tab
        $$('.nav-btn').forEach(b => b.classList.remove('active'));
        $$('.nav-btn[data-tab="receive"]').forEach(b => b.classList.add('active'));
        $$('.tab-content').forEach(t => t.classList.remove('active'));
        $('#tab-receive').classList.add('active');

        addReceivingProgress(info);
    };

    pm.onTransferProgress = (info) => {
        if (info.isSending) {
            updateSendProgress(info);
        } else {
            updateReceiveProgress(info);
        }
    };

    pm.onFileComplete = (data) => {
        showToast(`Received: ${data.name}`, 'success');
        addReceivedVideo(data);
    };

    pm.onError = (err) => {
        console.error(err);
        if (err.message) showToast(err.message, 'error');
    };

    // ===== PAIR ACTIONS =====
    $('#pairBtn').addEventListener('click', () => {
        const id = $('#pairIdInput').value.trim();
        if (!id) {
            showToast('Please enter a Device ID', 'warning');
            return;
        }
        if (id === pm.myId) {
            showToast("You can't connect to yourself!", 'warning');
            return;
        }

        showToast('Connecting...', 'info');
        pm.connectToPeer(id);

        $('#connectionStatus').style.display = 'block';
        $('#connStatusText').textContent = 'Connecting...';
        $('#connPeerId').textContent = id;
        $('.connection-info').classList.remove('connected');
    });

    $('#pasteBtn').addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            $('#pairIdInput').value = text;
            showToast('Pasted from clipboard', 'success');
        } catch {
            showToast('Unable to paste', 'error');
        }
    });

    $('#copyIdBtn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(pm.myId);
            showToast('ID copied!', 'success');
        } catch {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = pm.myId;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            showToast('ID copied!', 'success');
        }
    });

    // Modal actions
    $('#acceptPairBtn').addEventListener('click', () => {
        const peerId = $('#pairRequestId').textContent;
        const conn = pm.pendingPairRequests.get(peerId);
        if (conn) {
            pm.acceptPair(conn, peerId);
            showToast('Connection accepted!', 'success');
        }
        $('#pairModal').style.display = 'none';
    });

    $('#rejectPairBtn').addEventListener('click', () => {
        const peerId = $('#pairRequestId').textContent;
        pm.rejectPair(peerId);
        showToast('Connection rejected', 'info');
        $('#pairModal').style.display = 'none';
    });

    function updateConnectionStatus(peerId, connected) {
        const status = $('#connectionStatus');
        status.style.display = 'block';
        const info = status.querySelector('.connection-info');

        if (connected) {
            info.classList.add('connected');
            $('#connStatusText').textContent = 'Connected!';
            $('#connPeerId').textContent = peerId;
        } else {
            info.classList.remove('connected');
            $('#connStatusText').textContent = 'Disconnected';
            $('#connPeerId').textContent = peerId;
        }
    }

    // ===== FILE SELECTION =====
    const dropZone = $('#dropZone');
    const fileInput = $('#fileInput');

    $('#selectFilesBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        addFiles(Array.from(e.target.files));
        fileInput.value = '';
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/'));
        if (files.length === 0) {
            showToast('Please drop video files only', 'warning');
            return;
        }
        addFiles(files);
    });

    function addFiles(files) {
        files.forEach(f => {
            if (!selectedFiles.some(sf => sf.name === f.name && sf.size === f.size)) {
                selectedFiles.push(f);
            }
        });
        renderFileList();
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function renderFileList() {
        const section = $('#fileListSection');
        const list = $('#fileList');

        if (selectedFiles.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        $('#fileCount').textContent = selectedFiles.length;

        let totalBytes = 0;
        list.innerHTML = '';

        selectedFiles.forEach((file, idx) => {
            totalBytes += file.size;
            const item = document.createElement('div');
            item.className = 'file-item';
            item.style.animationDelay = (idx * 0.05) + 's';

            const thumbUrl = URL.createObjectURL(file);

            item.innerHTML = `
                <div class="file-thumb">
                    <video src="${thumbUrl}" muted preload="metadata"></video>
                </div>
                <div class="file-info">
                    <div class="file-name" title="${file.name}">${file.name}</div>
                    <div class="file-size">${formatSize(file.size)}</div>
                </div>
                <button class="file-remove" data-index="${idx}" title="Remove">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            `;
            list.appendChild(item);
        });

        $('#totalSize').textContent = formatSize(totalBytes);

        // Remove buttons
        list.querySelectorAll('.file-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                selectedFiles.splice(idx, 1);
                renderFileList();
            });
        });
    }

    $('#clearAllBtn').addEventListener('click', () => {
        selectedFiles = [];
        renderFileList();
    });

    // ===== SEND FILES =====
    $('#sendBtn').addEventListener('click', async () => {
        const targetId = $('#targetDeviceSelect').value;
        if (!targetId) {
            showToast('Select a connected device first', 'warning');
            return;
        }
        if (selectedFiles.length === 0) {
            showToast('No files selected', 'warning');
            return;
        }

        showToast(`Sending ${selectedFiles.length} video(s)...`, 'info');
        initSendProgress();

        try {
            await pm.sendFiles(targetId, selectedFiles);
            showToast('All videos sent successfully!', 'success');
        } catch (err) {
            showToast('Transfer failed: ' + err.message, 'error');
        }
    });

    function initSendProgress() {
        const container = $('#transferProgress');
        const list = $('#progressList');
        container.style.display = 'block';
        list.innerHTML = '';

        selectedFiles.forEach((file, idx) => {
            const item = document.createElement('div');
            item.className = 'progress-item';
            item.id = `send-progress-${idx}`;
            item.innerHTML = `
                <div class="progress-item-header">
                    <span class="progress-item-name">${file.name}</span>
                    <span class="progress-item-percent">0%</span>
                </div>
                <div class="progress-bar-wrapper glass-card-inner">
                    <div class="progress-bar"></div>
                </div>
            `;
            list.appendChild(item);
        });

        $('#overallProgress').style.width = '0%';
        $('#overallProgressText').textContent = '0%';
    }

    function updateSendProgress(info) {
        // Find by fileId -> index mapping
        const idx = parseInt(info.fileId.split('_')[2]);
        const item = $(`#send-progress-${idx}`);
        if (item) {
            item.querySelector('.progress-bar').style.width = info.percent + '%';
            item.querySelector('.progress-item-percent').textContent = info.percent + '%';
            if (info.percent >= 100) {
                item.classList.add('completed');
            }
        }

        // Update overall progress
        updateOverallProgress();
    }

    function updateOverallProgress() {
        const items = $$('#progressList .progress-item');
        if (items.length === 0) return;

        let total = 0;
        items.forEach(item => {
            const pct = parseInt(item.querySelector('.progress-item-percent').textContent);
            total += pct;
        });
        const overall = Math.round(total / items.length);
        $('#overallProgress').style.width = overall + '%';
        $('#overallProgressText').textContent = overall + '%';
    }

    // ===== RECEIVING =====
    function addReceivingProgress(info) {
        const list = $('#receivedList');
        // Remove empty state
        const empty = list.querySelector('.empty-state');
        if (empty) empty.remove();

        const existing = $(`#recv-${info.fileId}`);
        if (existing) return;

        const item = document.createElement('div');
        item.className = 'received-item';
        item.id = `recv-${info.fileId}`;
        item.innerHTML = `
            <div class="received-thumb">
                <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--purple-400);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                </div>
            </div>
            <div class="received-info">
                <div class="received-name">${info.name}</div>
                <div class="received-meta">${formatSize(info.size)} • Receiving...</div>
                <div class="receiving-bar">
                    <div class="progress-bar-wrapper glass-card-inner" style="margin-top:6px;">
                        <div class="progress-bar" style="width:0%"></div>
                    </div>
                </div>
            </div>
        `;
        list.prepend(item);
    }

    function updateReceiveProgress(info) {
        const item = $(`#recv-${info.fileId}`);
        if (item) {
            const bar = item.querySelector('.progress-bar');
            if (bar) bar.style.width = info.percent + '%';
            const meta = item.querySelector('.received-meta');
            if (meta) meta.textContent = `Receiving... ${info.percent}%`;
        }
    }

    function addReceivedVideo(data) {
        receivedVideos.push(data);

        const item = $(`#recv-${data.fileId}`);
        if (item) {
            const url = URL.createObjectURL(data.blob);

            item.querySelector('.received-thumb').innerHTML = `<video src="${url}" muted preload="metadata"></video>`;
            item.querySelector('.received-meta').textContent = `${formatSize(data.size)} • From: ${data.from}`;

            const receivingBar = item.querySelector('.receiving-bar');
            if (receivingBar) receivingBar.remove();

            // Add download button
            const dlBtn = document.createElement('button');
            dlBtn.className = 'received-download';
            dlBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px;">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Save
            `;
            dlBtn.addEventListener('click', () => {
                const a = document.createElement('a');
                a.href = url;
                a.download = data.name;
                a.click();
                showToast(`Downloading ${data.name}`, 'success');
            });
            item.appendChild(dlBtn);
        }
    }

    // ===== TARGET DEVICE SELECT =====
    function updateTargetSelect() {
        const select = $('#targetDeviceSelect');
        const connected = pm.getConnectedPeers();

        select.innerHTML = '';
        if (connected.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '-- No connected device --';
            select.appendChild(opt);
        } else {
            connected.forEach(id => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = id;
                select.appendChild(opt);
            });
        }
    }

    // ===== SAVED DEVICES =====
    function updateDevicesList() {
        const list = $('#savedDevicesList');
        const devices = pm.savedDevices;

        if (devices.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M8 15h8M9 9h.01M15 9h.01"/>
                    </svg>
                    <p>No saved devices yet</p>
                    <span>Pair with a device to save it here</span>
                </div>
            `;
            return;
        }

        list.innerHTML = '';
        const emojis = ['📱', '💻', '🖥️', '📟', '🎮'];

        devices.forEach((device, idx) => {
            const isConnected = pm.isConnected(device.id);
            const item = document.createElement('div');
            item.className = 'device-item';
            item.style.animationDelay = (idx * 0.05) + 's';

            item.innerHTML = `
                <div class="device-avatar">${emojis[idx % emojis.length]}</div>
                <div class="device-details">
                    <div class="device-name">${device.name} ${idx + 1}${isConnected ? ' 🟢' : ''}</div>
                    <div class="device-id-small">${device.id}</div>
                </div>
                <div class="device-actions">
                    <button class="device-connect-btn" data-id="${device.id}">
                        ${isConnected ? 'Connected' : 'Connect'}
                    </button>
                    <button class="device-delete-btn" data-id="${device.id}" title="Remove">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            `;
            list.appendChild(item);
        });

        // Connect buttons
        list.querySelectorAll('.device-connect-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
         
