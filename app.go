package main

import (
	"context"
	"open-idm/internal/downloader"
	"sync"
)

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

type App struct {
	ctx        context.Context
	downloader *downloader.Downloader
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.downloader = downloader.New(ctx)
}

func (a *App) StartDownload(url, filename string) string {
	return a.downloader.StartDownload(url, filename)
}

func (a *App) PauseDownload(id string) {
	a.downloader.PauseDownload(id)
}

func (a *App) ResumeDownload(id string) {
	a.downloader.ResumeDownload(id)
}
