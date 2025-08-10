import { StartDownload, PauseDownload, ResumeDownload } from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';

let downloads = {};

// Debug function
function debugLog(message, data) {
    console.log(`[DEBUG] ${message}`, data);
    // Tambahkan elemen debug ke halaman
    const debugContainer = document.getElementById('debug-container') || createDebugContainer();
    const debugItem = document.createElement('div');
    debugItem.className = 'debug-item';
    debugItem.textContent = `${new Date().toISOString()} - ${message}: ${JSON.stringify(data)}`;
    debugContainer.prepend(debugItem); // Tambahkan di awal agar yang terbaru di atas
}

function createDebugContainer() {
    const container = document.createElement('div');
    container.id = 'debug-container';
    container.style.cssText = 'margin-top: 20px; padding: 10px; border: 1px solid #ccc; max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 12px;';
    
    const heading = document.createElement('h3');
    heading.textContent = 'Debug Log';
    document.body.appendChild(heading);
    document.body.appendChild(container);
    return container;
}

// Ketika tombol start ditekan
document.getElementById("startBtn").onclick = () => {
    const url = document.getElementById("url").value.trim();
    const filename = document.getElementById("filename").value.trim();

    if (!url || !filename) {
        alert("URL dan nama file wajib diisi!");
        return;
    }

    debugLog("Starting download with", { url, filename });

    const id = Date.now().toString(); // ID unik berdasarkan waktu
    downloads[id] = { id, url, filename, progress: 0, paused: false };

    // Render UI
    renderDownload(id);

    // Mulai download
    StartDownload(url, filename)
        .then(downloadId => {
            debugLog("Download started with ID", downloadId);
            // Update ID jika backend mengembalikan ID yang berbeda
            if (downloadId && downloadId !== id) {
                downloads[downloadId] = downloads[id];
                downloads[downloadId].id = downloadId;
                delete downloads[id];
                // Update UI dengan ID baru jika perlu
                const row = document.getElementById(`row-${id}`);
                if (row) row.id = `row-${downloadId}`;
                const progress = document.getElementById(`progress-${id}`);
                if (progress) progress.id = `progress-${downloadId}`;
                const toggle = document.getElementById(`toggle-${id}`);
                if (toggle) {
                    toggle.id = `toggle-${downloadId}`;
                    toggle.onclick = () => togglePauseResume(downloadId);
                }
            }
        })
        .catch(err => {
            debugLog("Error starting download", err);
            alert(`Error starting download: ${err}`);
        });
};

function renderDownload(id) {
    const d = downloads[id];
    debugLog("Rendering download", d);
    const container = document.getElementById("downloads");

    const row = document.createElement("div");
    row.id = "row-" + id;
    row.className = "download-row";
    
    // Buat elemen secara terpisah untuk memastikan struktur DOM yang benar
    const downloadInfo = document.createElement("div");
    downloadInfo.className = "download-info";
    
    const downloadTitle = document.createElement("div");
    downloadTitle.className = "download-title";
    downloadTitle.textContent = d.filename;
    downloadInfo.appendChild(downloadTitle);
    
    const progressContainer = document.createElement("div");
    progressContainer.className = "progress-container";
    
    const progressBar = document.createElement("div");
    progressBar.className = "progress-bar";
    progressBar.id = `progress-bar-${id}`;
    progressBar.style.width = "0%";
    // Tambahkan style inline untuk debugging
    progressBar.style.backgroundColor = "var(--primary-color)";
    progressBar.style.height = "100%";
    progressBar.style.position = "absolute";
    progressBar.style.left = "0";
    progressBar.style.top = "0";
    
    progressContainer.appendChild(progressBar);
    downloadInfo.appendChild(progressContainer);
    
    const downloadStatus = document.createElement("div");
    downloadStatus.className = "download-status";
    
    const progressText = document.createElement("span");
    progressText.id = `progress-${id}`;
    progressText.textContent = "0%";
    downloadStatus.appendChild(progressText);
    
    downloadStatus.appendChild(document.createTextNode(" - "));
    
    const downloadUrl = document.createElement("span");
    downloadUrl.className = "download-url";
    downloadUrl.textContent = d.url;
    downloadStatus.appendChild(downloadUrl);
    
    downloadInfo.appendChild(downloadStatus);
    row.appendChild(downloadInfo);
    
    const downloadActions = document.createElement("div");
    downloadActions.className = "download-actions";
    
    const toggleButton = document.createElement("button");
    toggleButton.id = `toggle-${id}`;
    toggleButton.className = "btn small pause";
    toggleButton.innerHTML = `<i class="fas fa-pause"></i> Pause`;
    toggleButton.onclick = () => togglePauseResume(id);
    
    downloadActions.appendChild(toggleButton);
    row.appendChild(downloadActions);
    
    container.appendChild(row);
    
    // Debug untuk memastikan elemen dibuat dengan benar
    debugLog("Created progress bar", {
        id: `progress-bar-${id}`,
        element: progressBar.outerHTML,
        container: progressContainer.outerHTML
    });
}

function togglePauseResume(id) {
    const d = downloads[id];
    const btn = document.getElementById(`toggle-${id}`);

    debugLog("Toggle pause/resume for", { id, currentState: d.paused });

    if (d.paused) {
        ResumeDownload(id)
            .then(() => {
                debugLog("Resume successful", id);
                btn.innerHTML = '<i class="fas fa-pause"></i> Pause';
                btn.className = 'btn small pause';
                d.paused = false;
            })
            .catch(err => {
                debugLog("Resume error", err);
                alert(`Error resuming download: ${err}`);
            });
    } else {
        PauseDownload(id)
            .then(() => {
                debugLog("Pause successful", id);
                btn.innerHTML = '<i class="fas fa-play"></i> Resume';
                btn.className = 'btn small resume';
                d.paused = true;
            })
            .catch(err => {
                debugLog("Pause error", err);
                // Jangan tampilkan alert untuk error pause
                // karena biasanya ini hanya context canceled
            });
    }
}

// Pastikan event listener terdaftar
let eventListenersRegistered = false;

function registerEventListeners() {
    if (eventListenersRegistered) return;
    
    // Terima event progress dari Go
    // Tambahkan fungsi ini untuk memastikan progress bar terlihat
    function forceProgressBarUpdate(id, progress) {
        const progressBar = document.getElementById(`progress-bar-${id}`);
        if (!progressBar) {
            debugLog("Progress bar not found", id);
            return;
        }
        
        // Hapus dan tambahkan kembali elemen untuk memaksa browser me-render ulang
        const parent = progressBar.parentNode;
        const clone = progressBar.cloneNode(true);
        clone.style.width = `${progress}%`;
        parent.removeChild(progressBar);
        parent.appendChild(clone);
        
        debugLog("Forced progress bar update", {
            id: id,
            progress: progress,
            element: clone.outerHTML
        });
    }
    
    // Panggil fungsi ini di event listener download-progress
    EventsOn("download-progress", (data) => {
        debugLog("Received progress event", data);
        
        if (!data || !data.id) {
            debugLog("Invalid progress data", data);
            return;
        }
        
        if (downloads[data.id]) {
            downloads[data.id].progress = data.progress;
    
            const progressText = document.getElementById(`progress-${data.id}`);
            const progressBar = document.getElementById(`progress-bar-${data.id}`);
            
            debugLog("Progress elements", { 
                textElement: progressText ? "found" : "not found", 
                barElement: progressBar ? "found" : "not found",
                progress: data.progress
            });
            
            if (progressText) {
                progressText.innerText = `${data.progress}%`;
            }
            
            // Di dalam event listener download-progress
            if (progressBar) {
            // Log nilai width sebelum diubah
            const oldWidth = progressBar.style.width;
            
            // Pastikan nilai width diatur dengan benar
            progressBar.style.width = `${data.progress}%`;
            
            // Tambahkan warna yang berbeda berdasarkan progress
            if (data.progress < 30) {
                progressBar.style.backgroundColor = 'var(--warning-color)';
            } else if (data.progress < 70) {
                progressBar.style.backgroundColor = 'var(--primary-color)';
            } else {
                progressBar.style.backgroundColor = 'var(--success-color)';
            }
            
            // Log perubahan width untuk debugging
            debugLog("Updated progress bar", { 
                oldWidth: oldWidth, 
                newWidth: `${data.progress}%`,
                element: progressBar.outerHTML
            });
            
            // Force reflow untuk memastikan transisi terjadi
            void progressBar.offsetWidth;
            }
            
            // Tambahkan log untuk memastikan progress diperbarui
            debugLog("Updated progress UI", { id: data.id, progress: data.progress });
        } else {
            debugLog("Download not found for progress update", data.id);
        }
    });
    
    // Terima error dari Go
    EventsOn("download-error", (data) => {
        debugLog("Received error event", data);
        
        // Abaikan error context canceled
        if (data.error === "context canceled") {
            debugLog("Ignoring context canceled error", data);
            return;
        }
        
        alert(`Download error for ${downloads[data.id]?.filename || "unknown"}: ${data.error}`);
    });
    
    eventListenersRegistered = true;
    debugLog("Event listeners registered", { timestamp: Date.now() });
}

// Tambahkan fungsi ini untuk menampilkan debug visual
function addVisualDebug() {
    // Tambahkan style untuk debug
    const style = document.createElement('style');
    style.textContent = `
        .progress-container::before {
            content: 'Container';
            position: absolute;
            top: -15px;
            left: 0;
            font-size: 10px;
            color: yellow;
        }
        
        .progress-bar::before {
            content: attr(style);
            position: absolute;
            bottom: -15px;
            left: 0;
            font-size: 10px;
            color: cyan;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);
    
    // Tambahkan tombol untuk toggle debug visual
    const debugContainer = document.getElementById('debug-container') || createDebugContainer();
    const toggleDebugButton = document.createElement('button');
    toggleDebugButton.innerText = 'Toggle Visual Debug';
    toggleDebugButton.style.margin = '10px 0';
    toggleDebugButton.onclick = () => {
        const debugStyle = document.querySelector('style');
        debugStyle.disabled = !debugStyle.disabled;
    };
    
    debugContainer.parentNode.insertBefore(toggleDebugButton, debugContainer);
}

// Panggil fungsi ini saat halaman dimuat
document.addEventListener('DOMContentLoaded', addVisualDebug);
document.addEventListener('DOMContentLoaded', () => {
    debugLog("Page loaded", { timestamp: Date.now() });
    registerEventListeners();
});

// Panggil juga sekarang untuk memastikan
registerEventListeners();

// Log saat halaman dimuat
document.addEventListener('DOMContentLoaded', () => {
    debugLog("Page loaded", { timestamp: Date.now() });
});

// Fungsi untuk menguji progress bar
window.testProgressBar = function(id, progress) {
    if (!id) {
        // Gunakan ID download pertama jika tidak ada yang diberikan
        id = Object.keys(downloads)[0];
    }
    
    if (!id) {
        alert("Tidak ada download yang aktif");
        return;
    }
    
    progress = progress || 50; // Default 50%
    
    debugLog("Manual progress test", { id, progress });
    
    // Simulasikan event progress
    const progressBar = document.getElementById(`progress-bar-${id}`);
    const progressText = document.getElementById(`progress-${id}`);
    
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
        debugLog("Set progress bar width", { width: `${progress}%` });
    } else {
        debugLog("Progress bar element not found", id);
    }
    
    if (progressText) {
        progressText.innerText = `${progress}%`;
    }
};

// Tambahkan fungsi ini di bagian bawah file
window.testProgressAnimation = function(id) {
    if (!id) {
        // Gunakan ID download pertama jika tidak ada yang diberikan
        id = Object.keys(downloads)[0];
    }
    
    if (!id) {
        alert("Tidak ada download yang aktif");
        return;
    }
    
    const progressBar = document.getElementById(`progress-bar-${id}`);
    const progressText = document.getElementById(`progress-${id}`);
    
    if (!progressBar || !progressText) {
        alert("Elemen progress bar tidak ditemukan");
        return;
    }
    
    // Mulai dari 0%
    let progress = 0;
    
    // Update progress setiap 500ms
    const interval = setInterval(() => {
        progress += 10;
        
        if (progress > 100) {
            clearInterval(interval);
            return;
        }
        
        progressBar.style.width = `${progress}%`;
        progressText.innerText = `${progress}%`;
        
        // Ubah warna berdasarkan progress
        if (progress < 30) {
            progressBar.style.backgroundColor = 'var(--warning-color)';
        } else if (progress < 70) {
            progressBar.style.backgroundColor = 'var(--primary-color)';
        } else {
            progressBar.style.backgroundColor = 'var(--success-color)';
        }
        
        debugLog("Test animation progress", { progress, width: progressBar.style.width });
    }, 500);
};

// Tambahkan tombol test animasi di debug container
document.addEventListener('DOMContentLoaded', () => {
    const debugContainer = document.getElementById('debug-container') || createDebugContainer();
    
    const testAnimationButton = document.createElement('button');
    testAnimationButton.innerText = 'Test Progress Animation';
    testAnimationButton.style.margin = '10px 0';
    testAnimationButton.onclick = () => window.testProgressAnimation();
    
    debugContainer.parentNode.insertBefore(testAnimationButton, debugContainer);
});

// Tambahkan tombol test di debug container
document.addEventListener('DOMContentLoaded', () => {
    const debugContainer = document.getElementById('debug-container') || createDebugContainer();
    
    const testButton = document.createElement('button');
    testButton.innerText = 'Test Progress Bar';
    testButton.style.margin = '10px 0';
    testButton.onclick = () => window.testProgressBar();
    
    debugContainer.parentNode.insertBefore(testButton, debugContainer);
});
