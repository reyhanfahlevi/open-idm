package log

import (
	"context"
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func DebugCtx(ctx context.Context, message string, data interface{}) {
	fmt.Printf("[DEBUG] %s: %+v\n", message, data)
	// Opsional: kirim juga ke frontend
	runtime.EventsEmit(ctx, "debug-log", map[string]interface{}{
		"message": message,
		"data":    data,
	})
}

func InfoCtx(ctx context.Context, message string, data interface{}) {
	fmt.Printf("[INFO] %s: %+v\n", message, data)
	// Opsional: kirim juga ke frontend
	runtime.EventsEmit(ctx, "info-log", map[string]interface{}{
		"message": message,
		"data":    data,
	})
}

func ErrorCtx(ctx context.Context, message string, data interface{}) {
	fmt.Printf("[ERROR] %s: %+v\n", message, data)
	// Opsional: kirim juga ke frontend
	runtime.EventsEmit(ctx, "error-log", map[string]interface{}{
		"message": message,
		"data":    data,
	})
}
