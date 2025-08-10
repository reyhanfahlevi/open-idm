package downloader

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"open-idm/internal/pkg/log"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Downloader struct {
	ctx       context.Context
	downloads map[string]*DownloadTask
	mutex     sync.Mutex
}

type DownloadTask struct {
	ID             string
	URL            string
	Filename       string
	Cancel         context.CancelFunc
	DownloadedSize int64
	TotalSize      int64
	Paused         bool
	Mutex          sync.Mutex
}

func New(ctx context.Context) *Downloader {
	return &Downloader{
		ctx:       ctx,
		downloads: make(map[string]*DownloadTask),
	}
}

func (d *Downloader) StartDownload(url, filename string) string {
	id := uuid.New().String()
	log.DebugCtx(d.ctx, "StartDownload called", map[string]interface{}{
		"id":       id,
		"url":      url,
		"filename": filename,
	})

	ctx, cancel := context.WithCancel(d.ctx)
	task := &DownloadTask{
		ID:       id,
		URL:      url,
		Filename: filename,
		Cancel:   cancel,
		Paused:   false,
	}

	d.mutex.Lock()
	d.downloads[id] = task
	d.mutex.Unlock()

	go d.downloadFile(ctx, task)

	return id
}

func (d *Downloader) downloadFile(ctx context.Context, task *DownloadTask) {
	log.DebugCtx(ctx, "downloadFile started", task.ID)
	filePath := "downloads/" + task.Filename
	os.MkdirAll("downloads", 0755)

	var downloaded int64
	if stat, err := os.Stat(filePath); err == nil {
		downloaded = stat.Size()
		log.DebugCtx(ctx, "Existing file found", map[string]interface{}{
			"id":         task.ID,
			"downloaded": downloaded,
		})
	}
	task.DownloadedSize = downloaded

	req, err := http.NewRequestWithContext(ctx, "GET", task.URL, nil)
	if err != nil {
		log.DebugCtx(ctx, "Error creating request", map[string]interface{}{
			"id":    task.ID,
			"error": err.Error(),
		})
		d.emitError(task.ID, err)
		return
	}

	var rangeHeaderAdded bool
	if downloaded > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", downloaded))
		rangeHeaderAdded = true
		log.DebugCtx(ctx, "Added Range header", map[string]interface{}{
			"id":    task.ID,
			"range": fmt.Sprintf("bytes=%d-", downloaded),
		})
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.DebugCtx(ctx, "HTTP request error", map[string]interface{}{
			"id":    task.ID,
			"error": err.Error(),
		})
		d.emitError(task.ID, err)
		return
	}
	defer resp.Body.Close()

	log.DebugCtx(ctx, "HTTP response received", map[string]interface{}{
		"id":         task.ID,
		"statusCode": resp.StatusCode,
		"status":     resp.Status,
		"headers":    resp.Header,
	})

	if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
		log.DebugCtx(ctx, "Range not satisfiable, restarting download", task.ID)
		resp.Body.Close()

		os.Remove(filePath)

		req, err = http.NewRequestWithContext(ctx, "GET", task.URL, nil)
		if err != nil {
			d.emitError(task.ID, err)
			return
		}

		resp, err = http.DefaultClient.Do(req)
		if err != nil {
			d.emitError(task.ID, err)
			return
		}

		downloaded = 0
		task.DownloadedSize = 0
		rangeHeaderAdded = false
	} else if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		log.DebugCtx(ctx, "Unexpected status code", map[string]interface{}{
			"id":     task.ID,
			"status": resp.Status,
		})
		d.emitError(task.ID, fmt.Errorf("status: %s", resp.Status))
		return
	}

	if resp.StatusCode == http.StatusPartialContent {
		cr := resp.Header.Get("Content-Range")
		parts := strings.Split(cr, "/")
		if len(parts) == 2 {
			total, _ := strconv.ParseInt(parts[1], 10, 64)
			task.TotalSize = total
			log.DebugCtx(ctx, "Got total size from Content-Range", map[string]interface{}{
				"id":        task.ID,
				"totalSize": total,
			})
		}
	} else {
		task.TotalSize = resp.ContentLength
		log.DebugCtx(ctx, "Got total size from Content-Length", map[string]interface{}{
			"id":        task.ID,
			"totalSize": resp.ContentLength,
		})

		if rangeHeaderAdded && resp.StatusCode == http.StatusOK {
			log.DebugCtx(ctx, "Server doesn't support Range, starting from beginning", task.ID)
			downloaded = 0
			task.DownloadedSize = 0
			os.Remove(filePath)
		}
	}

	var file *os.File
	if downloaded > 0 {
		file, err = os.OpenFile(filePath, os.O_APPEND|os.O_WRONLY, 0644)
	} else {
		file, err = os.Create(filePath)
	}
	if err != nil {
		log.DebugCtx(ctx, "File open/create error", map[string]interface{}{
			"id":    task.ID,
			"error": err.Error(),
		})
		d.emitError(task.ID, err)
		return
	}
	defer file.Close()

	var progress int
	if task.TotalSize > 0 {
		progress = int((downloaded * 100) / task.TotalSize)
	}
	log.DebugCtx(ctx, "Sending initial progress", map[string]interface{}{
		"id":       task.ID,
		"progress": progress,
	})
	runtime.EventsEmit(d.ctx, "download-progress", map[string]any{
		"id":       task.ID,
		"progress": progress,
	})

	buf := make([]byte, 32*1024)
	for {
		select {
		case <-ctx.Done():
			// Periksa apakah pembatalan karena pause atau karena error lain
			if task.Paused {
				log.DebugCtx(ctx, "Download paused", task.ID)
			} else {
				log.DebugCtx(ctx, "Download cancelled", task.ID)
				// Hanya emit error jika bukan karena pause
				d.emitError(task.ID, ctx.Err())
			}
			return
		default:
			n, err := resp.Body.Read(buf)
			if n > 0 {
				if _, err := file.Write(buf[:n]); err != nil {
					log.DebugCtx(ctx, "File write error", map[string]interface{}{
						"id":    task.ID,
						"error": err.Error(),
					})
					d.emitError(task.ID, err)
					return
				}

				task.DownloadedSize += int64(n)
				if task.TotalSize > 0 {
					newProgress := int((task.DownloadedSize * 100) / task.TotalSize)
					// Kirim event jika progress berubah
					if newProgress != progress {
						progress = newProgress
						log.DebugCtx(ctx, "Sending progress update", map[string]interface{}{
							"id":             task.ID,
							"progress":       progress,
							"downloadedSize": task.DownloadedSize,
							"totalSize":      task.TotalSize,
						})
						runtime.EventsEmit(d.ctx, "download-progress", map[string]any{
							"id":       task.ID,
							"progress": progress,
						})
					}
				}
			}
			if err != nil {
				if err == io.EOF {
					log.DebugCtx(ctx, "Download completed", task.ID)
					runtime.EventsEmit(d.ctx, "download-progress", map[string]any{
						"id":       task.ID,
						"progress": 100,
					})
					return
				}
				log.DebugCtx(ctx, "Read error", map[string]interface{}{
					"id":    task.ID,
					"error": err.Error(),
				})
				d.emitError(task.ID, err)
				return
			}
		}
	}
}

func (d *Downloader) emitError(id string, err error) {
	// Jangan emit error context canceled jika download sedang di-pause
	if err != nil && err.Error() == "context canceled" {
		task, exists := d.downloads[id]
		if exists && task.Paused {
			log.DebugCtx(d.ctx, "Ignoring context canceled error for paused download", id)
			return
		}
	}

	log.DebugCtx(d.ctx, "Emitting error", map[string]interface{}{
		"id":    id,
		"error": err.Error(),
	})
	runtime.EventsEmit(d.ctx, "download-error", map[string]any{
		"id":    id,
		"error": err.Error(),
	})
}

func (d *Downloader) PauseDownload(id string) {
	d.mutex.Lock()
	defer d.mutex.Unlock()

	if task, exists := d.downloads[id]; exists && !task.Paused {
		task.Cancel()
		task.Paused = true
	}
}

func (d *Downloader) ResumeDownload(id string) {
	d.mutex.Lock()
	task, exists := d.downloads[id]
	d.mutex.Unlock()

	if !exists || !task.Paused {
		return
	}

	ctx, cancel := context.WithCancel(d.ctx)
	task.Cancel = cancel
	task.Paused = false

	go d.downloadFile(ctx, task)
}
