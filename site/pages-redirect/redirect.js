// The site moved from hamedmp.github.io/ai-insights/ to ai-insights.app. Share links put the stats in the #fragment,
// which never reaches a server, so the redirect has to run here in the browser to carry it across.
;(function () {
  var path = location.pathname.replace(/^\/ai-insights(?=\/|$)/, "") || "/"
  location.replace("https://ai-insights.app" + path + location.search + location.hash)
})()
