/**
 * Galaxy Transfer - App Controller
 * All UI logic and interactions
 */
(function() {
    'use strict';

    // ===== STARS =====
    const canvas = document.getElementById('starCanvas');
    const ctx = canvas.getContext('2d');
    let stars = [];

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function createStars() {
        stars = [];
        const count = Math.floor((canvas.width * canvas.height) / 8000);
        for (let i = 0; i < count; i++) {
            stars.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                r: 0.3 + Math.random() * 1.5,
                a: Math.random(),
                da: 0.003 + Math.random() * 0.008,
                dir: Math.random() > 0.5 ? 1 : -1
            });
        }
    }

    function drawStars() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const s of stars) {
            s.a += s.da * s.dir;
            if (s.a >= 1 || s.a <= 0) s.dir *= -1;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(200,180,255,${s.a * 0.7})`;
            ctx.fill();
        }
        requestAnimationFrame(drawStars);
    }

    resizeCanvas();
    createStars();
    drawStars();
    window.addEventListener('resize', () => { resizeCanvas(); createStars(); });

    // ===== HELPERS =====
    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    function toast(msg, type = 'inf') {
        const box = $('#toastBox');
        const icons = { ok: '✅', err: '❌', inf: '💜', wrn: '⚠️' };
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<span>${icons[type] || '💜'}</span><span>${msg}</span>`;
        box.appendChild(t);
        setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
    }

    function fmtSize(b) {
        if (!b) return '0 B';
        const u = ['B','KB','MB','GB','TB'];
        const i = Math.floor(Math.log(b) / Math.log(1024));
        return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
    }

    // ===== TABS =====
    $$('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            $$('.tab').forEach(t => t.classList.remove('active'));
            const tab = $(`#tab-${btn.dataset.tab}`);
            tab.classList.add('active');
            tab.style.animation = 'none';
            tab.offsetHeight;
            tab.style.animation = '';
        });
    });

    function switchTab(name) {
        $$('.nav-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === name);
        });
        $$('.tab').forEach(t => t.classList.remove('active'));
        $(`#tab-${name}`).classList.add('active');
    }

    // ===== PEER INIT =====
    const gp = new GalaxyPeer();
    let selectedFiles = [];

    gp.onStatus = (s) => {
        const dot = $('#peerStatus .status-dot');
        const txt = $('#peerStatusText');
        dot.className = 'status-dot';

        switch(s) {
            case 'online':
                dot.classList.add('online');
                txt.textContent = 'Connected to network ✓';
                break;
            case 'connecting':
                dot.classList.add('offline');
                txt.textContent = 'Connecting to network...';
                break;
            case 'reconnecting':
                dot.classList.add('offline');
                txt.textContent = 'Reconnecting...';
                break;
            case 'offline':
                dot.classList.add('error');
                txt.textContent = 'Offline';
                break;
        }
    };

    gp.onReady = (id) => {
        $('#myIdCode').textContent = id;
        $('#headerIdText').textContent = id;
        toast('Device ready!', 'ok');
    };

    gp.onError = (e) => {
        toast(e.message || 'Error occurred', 'err');
    };

    gp.onPairRequest = (pid) => {
        $('#modalPeerId').textContent = pid;
        $('#pairModal').classList.add('show');
    };

    gp.onConnected = (pid) => {
        toast(`Connected: ${pid}`, 'ok');
        gp.saveDevice(pid);
        showConn(pid, true);
        refreshDevices();
        refreshTargets();
    };

    gp.onPairAccepted = (pid) => {
        toast(`Paired with ${pid}!`, 'ok');
        gp.saveDevice(pid);
        showConn(pid, true);
        refreshDevices();
        refreshTargets();
    };

    gp.onPairRejected = (pid) => {
        toast('Connection rejected', 'err');
        showConn(pid, false);
    };

    gp.onDisconnected = (pid) => {
        toast(`${pid} disconnected`, 'wrn');
        showConn(pid, false);
        refreshTargets();
    };

    gp.onFileStart = (m) => {
        toast(`Receiving: ${m.name}`, 'inf');
        switchTab('inbox');
        $('#inboxDot').style.display = 'block';
        addRecvItem(m);
    };

    gp.onProgress = (p) => {
        if (p.sending) {
            updateSendProg(p);
        } else {
            updateRecvProg(p);
        }
    };

    gp.onFileComplete = (data) => {
        toast(`✅ ${data.name}`, 'ok');
        finalizeRecv(data);
    };

    // ===== PAIR UI =====
    $('#btnConnect').addEventListener('click', () => {
        const id = $('#pairInput').value.trim().toUpperCase();
        if (!id) { toast('Enter a Device ID', 'wrn'); return; }
        toast('Connecting...', 'inf');
        gp.connect(id);
        showConn(id, null); // null = connecting
    });

    $('#pairInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') $('#btnConnect').click();
    });

    $('#btnPaste').addEventListener('click', async () => {
        try {
            const t = await navigator.clipboard.readText();
            $('#pairInput').value = t.trim();
            toast('Pasted!', 'ok');
        } catch {
            toast('Paste not available', 'wrn');
        }
    });

    $('#btnCopy').addEventListener('click', () => {
        const id = gp.myId;
        if (!id) { toast('ID not ready yet', 'wrn'); return; }
        copyText(id);
    });

    $('#headerBadge').addEventListener('click', () => {
        const id = gp.myId;
        if (!id) { toast('ID not ready yet', 'wrn'); return; }
        copyText(id);
    });

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => toast('Copied: ' + text, 'ok'))
                .catch(() => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            toast('Copied: ' + text, 'ok');
        } catch {
            toast('Copy failed. ID: ' + text, 'wrn');
        }
        ta.remove();
    }

    // Modal
    $('#btnAccept').addEventListener('click', () => {
        const pid = $('#modalPeerId').textContent;
        gp.acceptPair(pid);
        $('#pairModal').classList.remove('show');
        toast('Accepted!', 'ok');
    });

    $('#btnReject').addEventListener('click', () => {
        const pid = $('#modalPeerId').textContent;
        gp.rejectPair(pid);
        $('#pairModal').classList.remove('show');
        toast('Rejected', 'inf');
    });

    function showConn(pid, state) {
        const card = $('#connCard');
        const info = $('#connInfo');
        const text = $('#connText');
        const peer = $('#connPeer');

        card.style.display = 'block';
        peer.textContent = pid;

        if (state === null) {
            info.className = 'conn-status';
            text.textContent = 'Connecting...';
        } else if (state) {
            info.className = 'conn-status ok';
            text.textContent = 'Connected!';
        } else {
            info.className = 'conn-status';
            text.textContent = 'Disconnected';
        }
    }

    // ===== FILE SELECT =====
    const dropArea = $('#dropArea');
    const fileInput = $('#fileInput');

    $('#btnBrowse').addEventListener('click', e => {
        e.stopPropagation();
        fileInput.click();
    });

    dropArea.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', e => {
        addFiles(Array.from(e.target.files));
        fileInput.value = '';
    });

    dropArea.addEventListener('dragover', e => {
        e.preventDefault();
        dropArea.classList.add('over');
    });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('over'));
    dropArea.addEventListener('drop', e => {
        e.preventDefault();
        dropArea.classList.remove('over');
        const vids = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/'));
        if (!vids.length) { toast('Only video files', 'wrn'); return; }
        addFiles(vids);
    });

    function addFiles(files) {
        for (const f of files) {
            if (!selectedFiles.some(s => s.name === f.name && s.size === f.size)) {
                selectedFiles.push(f);
            }
        }
        renderFiles();
    }

    function renderFiles() {
        const sec = $('#fileSection');
        const list = $('#fileList');

        if (!selectedFiles.length) {
            sec.style.display = 'none';
            return;
        }

        sec.style.display = 'block';
        $('#fCount').textContent = selectedFiles.length;

        let total = 0;
        list.innerHTML = '';

        selectedFiles.forEach((f, i) => {
            total += f.size;
            const el = document.createElement('div');
            el.className = 'f-item';
            el.style.animationDelay = (i * 0.04) + 's';

            let thumb = '<div class="f-thumb">🎬</div>';
            try {
                const url = URL.createObjectURL(f);
                thumb = `<div class="f-thumb"><video src="${url}" muted preload="metadata"></video></div>`;
            } catch(e) {}

            el.innerHTML = `
                ${thumb}
                <div class="f-info">
                    <div class="f-name" title="${f.name}">${f.name}</div>
                    <div class="f-size">${fmtSize(f.size)}</div>
                </div>
                <button class="f-del" data-i="${i}">✕</button>
            `;
            list.appendChild(el);
        });

        $('#fTotal').textContent = fmtSize(total);

        list.querySelectorAll('.f-del').forEach(b => {
            b.addEventListener('click', e => {
                e.stopPropagation();
                selectedFiles.splice(+b.dataset.i, 1);
                renderFiles();
            });
        });
    }

    $('#btnClearFiles').addEventListener('click', () => {
        selectedFiles = [];
        renderFiles();
    });

    // ===== SEND =====
    $('#btnSend').addEventListener('click', async () => {
        const target = $('#targetSelect').value;
        if (!target) { toast('Select a device first', 'wrn'); return; }
        if (!selectedFiles.length) { toast('No files selected', 'wrn'); return; }

        toast(`Sending ${selectedFiles.length} video(s)...`, 'inf');
        initSendProg();

        try {
            await gp.sendFiles(target, selectedFiles);
            toast('All sent! ✅', 'ok');
        } catch(err) {
            toast('Failed: ' + (err.message || err), 'err');
        }
    });

    function initSendProg() {
        const card = $('#progressCard');
        const list = $('#progressList');
        card.style.display = 'block';
        list.innerHTML = '';

        selectedFiles.forEach((f, i) => {
            const el = document.createElement('div');
            el.className = 'p-item';
            el.id = `sp-${i}`;
            el.innerHTML = `
                <div class="p-head">
                    <span class="p-name">${f.name}</span>
                    <span class="p-pct">0%</span>
                </div>
                <div class="pbar-wrap glass-inner"><div class="pbar"></div></div>
            `;
            list.appendChild(el);
        });

        $('#overallBar').style.width = '0%';
        $('#overallText').textContent = '0%';
    }

    function updateSendProg(p) {
        const el = $(`#sp-${p.idx}`);
        if (el) {
            el.querySelector('.pbar').style.width = p.pct + '%';
            el.querySelector('.p-pct').textContent = p.pct + '%';
            if (p.pct >= 100) el.classList.add('done');
        }
        updateOverall();
    }

    function updateOverall() {
        const items = $$('#progressList .p-item');
        if (!items.length) return;
        let sum = 0;
        items.forEach(el => { sum += parseInt(el.querySelector('.p-pct').textContent) || 0; });
        const avg = Math.round(sum / items.length);
        $('#overallBar').style.width = avg + '%';
        $('#overallText').textContent = avg + '%';
    }

    // ===== RECEIVE =====
    function addRecvItem(m) {
        const list = $('#inboxList');
        const empty = list.querySelector('.empty');
        if (empty) empty.remove();

        if ($(`#ri-${m.fid}`)) return;

        const el = document.createElement('div');
        el.className = 'i-item';
        el.id = `ri-${m.fid}`;
        el.innerHTML = `
            <div class="i-thumb">🎬</div>
            <div class="i-info">
                <div class="i-name">${m.name}</div>
                <div class="i-meta">${fmtSize(m.size)} • Receiving...</div>
                <div class="i-recv-bar">
                    <div class="pbar-wrap glass-inner"><div class="pbar" style="width:0%"></div></div>
                </div>
            </div>
        `;
        list.prepend(el);
    }

    function updateRecvProg(p) {
        const el = $(`#ri-${p.fid}`);
        if (el) {
            const bar = el.querySelector('.pbar');
            if (bar) bar.style.width = p.pct + '%';
            const meta = el.querySelector('.i-meta');
            if (meta) meta.textContent = `${fmtSize(p.done * 64 * 1024)} / ${p.pct}%`;
        }
    }

    function finalizeRecv(data) {
        const el = $(`#ri-${data.fid}`);
        if (!el) return;

        const url = URL.createObjectURL(data.blob);

        el.querySelector('.i-thumb').innerHTML = `<video src="${url}" muted preload="metadata"></video>`;
        el.querySelector('.i-meta').textContent = `${fmtSize(data.size)} • From: ${data.from}`;

        const bar = el.querySelector('.i-recv-bar');
        if (bar) bar.remove();

        const btn = document.createElement('button');
        btn.className = 'i-dl';
        btn.textContent = '💾 Save';
        btn.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = data.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            toast('Downloading...', 'ok');
        });
        el.appendChild(btn);
    }

    // ===== TARGETS =====
    function refreshTargets() {
        const sel = $('#targetSelect');
        const peers = gp.peers();
        sel.innerHTML = '';

        if (!peers.length) {
            sel.innerHTML = '<option value="">No device connected</option>';
        } else {
            peers.forEach(id => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = id;
                sel.appendChild(opt);
            });
        }
    }

    // ===== SAVED DEVICES =====
    function refreshDevices() {
        const list = $('#deviceList');
        const devs = gp.saved;

        if (!devs.length) {
            list.innerHTML = `
                <div class="empty">
                    <div class="empty-icon">📱</div>
                    <p>No saved devices</p>
                    <span>Pair a device to save it here</span>
                </div>
            `;
            return;
        }

        const icons = ['📱','💻','🖥️','🎮','📟'];
        list.innerHTML = '';

        devs.forEach((d, i) => {
            const online = gp.isConn(d.id);
            const el = document.createElement('div');
            el.className = 'd-item';
            el.style.animationDelay = (i * 0.05) + 's';
            el.innerHTML = `
                <div class="d-avatar">${icons[i % icons.length]}</div>
                <div class="d-info">
                    <div class="d-name">${d.name}${online ? ' 🟢' : ''}</div>
                    <div class="d-id">${d.id}</div>
                </div>
                <div class="d-actions">
                    <button class="d-conn" data-id="${d.id}">${online ? 'Online' : 'Connect'}</button>
                    <button class="d-del" data-id="${d.id}">🗑</button>
                </div>
            `;
            list.appendChild(el);
        });

        list.querySelectorAll('.d-conn').forEach(b => {
            b.addEventListener('click', () => {
                if (!gp.isConn(b.dataset.id)) {
                    gp.connect(b.dataset.id);
                    toast('Connecting...', 'inf');
                }
            });
        });

        list.querySelectorAll('.d-del').forEach(b => {
            b.addEventListener('click', () => {
                gp.disconnect(b.dataset.id);
                gp.removeDevice(b.dataset.id);
                refreshDevices();
                refreshTargets();
                toast('Removed', 'inf');
            });
        });
    }

    // Init empty inbox
    function initInbox() {
        const list = $('#inboxList');
        if (!list.children.length) {
            list.innerHTML = `
                <div class="empty">
                    <div class="empty-icon">📥</div>
                    <p>No videos received</p>
                    <span>Videos appear here when received</span>
                </div>
            `;
        }
    }

    refreshDevices();
    refreshTargets();
    initInbox();

})();
