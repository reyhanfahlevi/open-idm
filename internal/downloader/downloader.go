package downloader

import (
	"context"
	"open-idm/internal/pkg/log"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Downloader struct {
	ctx       context.Context
	downloads map[string]*DownloadTask
	mutex     sync.Mutex
}

func New(ctx context.Context) *Downloader {
	return &Downloader{
		ctx:       ctx,
		downloads: make(map[string]*DownloadTask),
	}
}

func (d *Downloader) StartDownload(url, filename string) string {
	task := NewDownloadTask(d.ctx, url, filename)

	d.mutex.Lock()
	d.downloads[task.id] = task
	d.mutex.Unlock()

	go task.StartDownload()

	return task.id
}

func (d *Downloader) emitError(id string, err error) {
	if err != nil && err.Error() == "context canceled" {
		task, exists := d.downloads[id]
		if exists && task.paused {
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

	if task, exists := d.downloads[id]; exists && !task.paused {
		task.PauseDownload()
	}
}

func (d *Downloader) ResumeDownload(id string) {
	d.mutex.Lock()
	task, exists := d.downloads[id]
	d.mutex.Unlock()

	if !exists || !task.paused {
		return
	}

	go task.ResumeDownload(d.ctx)
}
