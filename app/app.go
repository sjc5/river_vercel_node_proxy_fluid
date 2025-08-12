package app

import (
	"embed"
	"net/http"

	"github.com/river-now/river"
	"github.com/river-now/river/kit/colorlog"
	"github.com/river-now/river/kit/headels"
	"github.com/river-now/river/kit/htmlutil"
	"github.com/river-now/river/wave"
)

var River = &river.River{
	Wave: Wave,
	GetHeadElUniqueRules: func() *headels.HeadEls {
		e := river.NewHeadEls(2)

		e.Meta(e.Property("og:title"))
		e.Meta(e.Property("og:description"))

		return e
	},
	GetDefaultHeadEls: func(r *http.Request) ([]*htmlutil.Element, error) {
		e := river.NewHeadEls()

		e.Title("River Example")
		e.Description("This is a River example.")

		return e.Collect(), nil
	},
	GetRootTemplateData: func(r *http.Request) (map[string]any, error) {
		// This gets fed into backend/__static/entry.go.html
		return map[string]any{}, nil
	},
}

//go:embed wave.config.json
var configBytes []byte

//go:embed all:__dist/static
var staticFS embed.FS

var Wave = wave.New(&wave.Config{
	ConfigBytes:            configBytes,
	StaticFS:               staticFS,
	StaticFSEmbedDirective: "all:__dist/static",
})

var Log = colorlog.New("app")
