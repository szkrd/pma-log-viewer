# pma-log-viewer

Pma txt log viewer.

## usage

1. `npm i&& npm run dev`
2. place the log file into the `src` folder
3. open http://localhost:19007 (lists log files and available parameters)

examples:

- http://localhost:19007/ = list logs, help
- http://localhost:19007/sample.txt = render log as is
- http://localhost:19007/sample.txt?subType=WebView,Survey = subType equals one of these types
- http://localhost:19007/sample.txt?noResourceLoads=1 = skip url load info
- http://localhost:19007/sample.txt?onlyFrontendNotify=1 = show only logs sent by frontend (android)
- http://localhost:19007/sample.txt?actionIncludes=Survey%20response,OnWebViewLoad = action field includes any of these substrings
