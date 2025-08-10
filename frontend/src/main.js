import { StartDownload, PauseDownload, ResumeDownload } from '../wailsjs/go/main/App.js';
import { EventsOn } from '../wailsjs/runtime/runtime.js';

let downloads = {};

function debugLog(message, data) {
    console.log(`[DEBUG] ${message}`, data);
    const debugContainer = document.getElementById('debug-container') || createDebugContainer();
    const debugItem = document.createElement('div');
    debugItem.className = 'debug-item';
    debugItem.textContent = `${new Date().toISOString()} - ${message}: ${JSON.stringify(data)}`;
    debugContainer.prepend(debugItem);
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

document.getElementById("startBtn").onclick = () => {
    const url = document.getElementById("url").value.trim();
    const filename = document.getElementById("filename").value.trim();

    if (!url) {
        return;
    }

    debugLog("Starting download with", { url, filename });

    StartDownload(url, filename)
        .then(id => {
            debugLog("Download started with ID", id);
           
            if (id) {
                downloads[id] = { id, url, filename, progress: 0, paused: false };
                renderDownload(id);
                const row = document.getElementById(`row-${id}`);
                if (row) row.id = `row-${id}`;
                const progress = document.getElementById(`progress-${id}`);
                if (progress) progress.id = `progress-${id}`;
                const toggle = document.getElementById(`toggle-${id}`);
                if (toggle) {
                    toggle.id = `toggle-${id}`;
                    toggle.onclick = () => togglePauseResume(id);
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
    
    const downloadInfo = document.createElement("div");
    downloadInfo.className = "download-info";
    
    const downloadTitle = document.createElement("div");
    downloadTitle.id = `download-title-${id}`;
    downloadTitle.className = `download-title`;
    downloadTitle.textContent = d.filename;
    downloadInfo.appendChild(downloadTitle);
    
    const progressContainer = document.createElement("div");
    progressContainer.className = "progress-container";
    
    const progressBar = document.createElement("div");
    progressBar.className = "progress-bar";
    progressBar.id = `progress-bar-${id}`;
    progressBar.style.width = "0%";
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
            });
    }
}

let eventListenersRegistered = false;

function registerEventListeners() {
    if (eventListenersRegistered) return;
    
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
            const downloadTitle = document.getElementById(`download-title-${data.id}`);
            
            debugLog("Progress elements", { 
                textElement: progressText ? "found" : "not found", 
                barElement: progressBar ? "found" : "not found",
                progress: data.progress
            });
            
            if (progressText) {
                progressText.innerText = `${data.progress}%`;
            }
            
            if (progressBar) {
            const oldWidth = progressBar.style.width;
            
            progressBar.style.width = `${data.progress}%`;
            
            if (data.progress < 30) {
                progressBar.style.backgroundColor = 'var(--warning-color)';
            } else if (data.progress < 70) {
                progressBar.style.backgroundColor = 'var(--primary-color)';
            } else {
                progressBar.style.backgroundColor = 'var(--success-color)';
            }

            if (data.filename !== downloadTitle.textContent) {
                downloads[data.id].filename = data.filename;
                downloadTitle.textContent = data.filename;
            }

            if (data.progress === 100) {
                const toggleButton = document.getElementById(`toggle-${data.id}`);
                toggleButton.remove();
            }
            
            debugLog("Updated progress bar", { 
                oldWidth: oldWidth, 
                newWidth: `${data.progress}%`,
                element: progressBar.outerHTML
            });
            
            void progressBar.offsetWidth;
            }
            
            debugLog("Updated progress UI", { id: data.id, progress: data.progress });
        } else {
            debugLog("Download not found for progress update", data.id);
        }
    });
    
    EventsOn("download-error", (data) => {
        debugLog("Received error event", data);
        
        if (data.error === "context canceled") {
            debugLog("Ignoring context canceled error", data);
            return;
        }
        
        alert(`Download error for ${downloads[data.id]?.filename || "unknown"}: ${data.error}`);
    });
    
    eventListenersRegistered = true;
    debugLog("Event listeners registered", { timestamp: Date.now() });
}

function addVisualDebug() {
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
    
    // const debugContainer = document.getElementById('debug-container') || createDebugContainer();
    // const toggleDebugButton = document.createElement('button');
    // toggleDebugButton.innerText = 'Toggle Visual Debug';
    // toggleDebugButton.style.margin = '10px 0';
    // toggleDebugButton.onclick = () => {
    //     const debugStyle = document.querySelector('style');
    //     debugStyle.disabled = !debugStyle.disabled;
    // };
    
    // debugContainer.parentNode.insertBefore(toggleDebugButton, debugContainer);
}

document.addEventListener('DOMContentLoaded', addVisualDebug);
document.addEventListener('DOMContentLoaded', () => {
    debugLog("Page loaded", { timestamp: Date.now() });
    registerEventListeners();
});

registerEventListeners();

document.addEventListener('DOMContentLoaded', () => {
    debugLog("Page loaded", { timestamp: Date.now() });
});