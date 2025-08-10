package downloader

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"open-idm/internal/pkg/log"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type DownloadTask struct {
	id             string
	url            string
	filename       string
	SavePath       string
	ctx            context.Context
	cancel         context.CancelFunc
	downloadedSize int64
	totalSize      int64
	paused         bool
	completed      bool
	progress       int

	file *os.File

	lock *sync.Mutex
}

func NewDownloadTask(ctx context.Context, url, filename string) *DownloadTask {
	ctx, cancel := context.WithCancel(ctx)

	return &DownloadTask{
		id:       uuid.New().String(),
		ctx:      ctx,
		cancel:   cancel,
		url:      url,
		filename: filename,
		lock:     &sync.Mutex{},
	}
}

func (t *DownloadTask) Progress() int {
	t.lock.Lock()
	defer t.lock.Unlock()

	return int((t.downloadedSize * 100) / t.totalSize)

}

func (t *DownloadTask) PauseDownload() error {
	t.cancel()
	t.paused = true
	return nil
}

func (t *DownloadTask) ResumeDownload(ctx context.Context) error {
	t.ctx, t.cancel = context.WithCancel(ctx)
	t.paused = false
	return t.StartDownload()
}

func (t *DownloadTask) complete() {
	runtime.EventsEmit(t.ctx, "download-progress", map[string]any{
		"id":       t.id,
		"progress": 100,
		"filename": t.filename,
	})

	t.file.Close()
	filePath := t.file.Name()
	fileDir := filepath.Dir(filePath)
	finalPath := filepath.Join(fileDir, t.filename)

	// if there is duplicate, add numbering
	if _, err := os.Stat(finalPath); err == nil {
		baseName := strings.TrimSuffix(t.filename, filepath.Ext(t.filename))
		ext := filepath.Ext(t.filename)
		i := 1
		for {
			newName := fmt.Sprintf("%s_%d%s", baseName, i, ext)
			finalPath = filepath.Join(fileDir, newName)
			if _, err := os.Stat(finalPath); err != nil {
				break
			}
			i++
		}

	}

	log.InfoCtx(t.ctx, "File Path:", map[string]interface{}{
		"filePath":  filePath,
		"finalPath": finalPath,
		"filename":  t.filename,
		"fileDir":   fileDir,
	})

	err := os.Rename(filePath, finalPath)
	if err != nil {
		log.ErrorCtx(t.ctx, "Error renaming file", map[string]interface{}{
			"id":    t.id,
			"error": err.Error(),
		})
	}

	t.completed = true
	t.cancel()
}

func (t *DownloadTask) pushProgress() {

	newProgress := t.Progress()
	if newProgress == t.progress {
		return
	}

	t.progress = newProgress
	if t.totalSize == 0 {
		return
	}

	runtime.EventsEmit(t.ctx, "download-progress", map[string]any{
		"id":       t.id,
		"progress": t.progress,
		"filename": t.filename,
	})
}

func (t *DownloadTask) StartDownload() error {
	req, err := http.NewRequestWithContext(t.ctx, "GET", t.url, nil)
	if err != nil {
		log.DebugCtx(t.ctx, "Error creating request", map[string]interface{}{
			"id":    t.id,
			"error": err.Error(),
		})
		return err
	}

	var rangeHeaderAdded bool
	if t.downloadedSize > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", t.downloadedSize))
		rangeHeaderAdded = true
		log.DebugCtx(t.ctx, "Added Range header", map[string]interface{}{
			"id":    t.id,
			"range": fmt.Sprintf("bytes=%d-", t.downloadedSize),
		})
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.DebugCtx(t.ctx, "HTTP request error", map[string]interface{}{
			"id":    t.id,
			"error": err.Error(),
		})
		return err
	}
	defer resp.Body.Close()

	if t.filename == "" {
		t.filename = t.getFilename(t.url, resp)
		log.DebugCtx(t.ctx, "Filename determined", map[string]interface{}{
			"id":                 t.id,
			"filename":           t.filename,
			"contentDisposition": resp.Header.Get("Content-Disposition"),
		})
	}

	switch resp.StatusCode {
	case http.StatusRequestedRangeNotSatisfiable:
		log.DebugCtx(t.ctx, "Range not satisfiable, restarting download", t.id)
		resp.Body.Close()

		req, err = http.NewRequestWithContext(t.ctx, "GET", t.url, nil)
		if err != nil {
			return err
		}

		resp, err = http.DefaultClient.Do(req)
		if err != nil {
			return err
		}

		t.downloadedSize = 0
		rangeHeaderAdded = false
	case http.StatusPartialContent:
		cr := resp.Header.Get("Content-Range")
		parts := strings.Split(cr, "/")
		if len(parts) == 2 {
			total, _ := strconv.ParseInt(parts[1], 10, 64)
			t.totalSize = total
			log.DebugCtx(t.ctx, "Got total size from Content-Range", map[string]interface{}{

				"id":        t.id,
				"totalSize": total,
			})
		}

	case http.StatusOK:
		t.totalSize = resp.ContentLength
		log.DebugCtx(t.ctx, "Got total size from Content-Length", map[string]interface{}{

			"id":        t.id,
			"totalSize": resp.ContentLength,
		})
		if rangeHeaderAdded {
			log.DebugCtx(t.ctx, "Server doesn't support Range, starting from beginning", t.id)

			t.downloadedSize = 0
			// os.Remove(filePath)
		}

	default:
		log.DebugCtx(t.ctx, "Unexpected status code", map[string]interface{}{

			"id":     t.id,
			"status": resp.Status,
		})
		return err
	}

	buf := make([]byte, 1024)
	for {
		select {
		case <-t.ctx.Done():
			if t.paused {
				log.DebugCtx(t.ctx, "Download paused", t.id)
			} else if t.completed {
				log.DebugCtx(t.ctx, "Download completed", t.id)
			} else {
				log.DebugCtx(t.ctx, "Download cancelled", t.id)
			}
			return err
		default:
			n, err := resp.Body.Read(buf)
			if n > 0 {
				err = t.writeToFile(t.ctx, buf[:n])

				if err != nil {
					log.DebugCtx(t.ctx, "Error writing to file", map[string]interface{}{
						"id":    t.id,
						"error": err.Error(),
					})
					return err
				}

				t.pushProgress()
			}
			if err != nil {
				if err == io.EOF {
					t.pushProgress()
					t.complete()
					break
				}

				return err
			}
		}
	}
}

func (t *DownloadTask) writeToFile(ctx context.Context, data []byte) error {
	var err error
	os.MkdirAll("downloads", 0755)
	filePath := filepath.Join("downloads", t.id)

	if t.file == nil {
		_, err = os.Stat(filePath)
		if err != nil {
			if os.IsNotExist(err) {
				t.file, err = os.Create(filePath)
				if err != nil {
					log.DebugCtx(ctx, "Error creating file", map[string]interface{}{
						"id":    t.id,
						"error": err.Error(),
					})
					return err
				}
			} else {
				log.DebugCtx(ctx, "Error checking file existence", map[string]interface{}{
					"id":    t.id,
					"error": err.Error(),
				})
				return err
			}
		}
	}

	_, err = t.file.Write(data)
	if err != nil {
		log.DebugCtx(ctx, "Error writing to file", map[string]interface{}{
			"id":    t.id,
			"error": err.Error(),
		})
		return err
	}

	t.downloadedSize += int64(len(data))
	return nil
}

func (t *DownloadTask) sanitizeFilename(filename string) string {
	re := regexp.MustCompile(`[<>:"/\\|?*]`)
	return re.ReplaceAllString(filename, "_")
}

func (t *DownloadTask) getFilename(urlStr string, resp *http.Response) string {
	var filename string

	if contentDisposition := resp.Header.Get("Content-Disposition"); contentDisposition != "" {
		if strings.HasPrefix(contentDisposition, "attachment;") {
			params := strings.Split(contentDisposition, ";")
			for _, param := range params {
				param = strings.TrimSpace(param)
				if strings.HasPrefix(param, "filename=") {
					filename = strings.Trim(param[len("filename="):], "\"")
					break
				}
			}
		}
	}

	if filename == "" {
		parsedURL, err := url.Parse(urlStr)
		if err == nil {
			filename = path.Base(parsedURL.Path)
		}
	}

	if filename == "" {
		filename = "download"
	}

	return t.sanitizeFilename(filename)
}
