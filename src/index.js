const path = require('path');
const fs = require('fs');
const express = require('express');
const { escape } = require('lodash');
const app = express();
const port = parseInt(process.env.PORT, 10) || 19007;

// client side styles and javascript
const style = `<style>
  tr.subType_WebView { background-color: #dfd; }
  tr.subType_Survey { background-color: #ddf; }
  tr.subType_Error, tr.type_Exception { background-color: #fdd; }
  td { border-bottom: 1px solid silver; }
  th { text-align: left; border: 1px solid black; position: sticky; top: 0; background-color: rgba(255,255,255,.8); }
  td.line-number { font-size: x-small; color: silver; text-align: right; }
  td.time { font-size: x-small; color: gray; text-align: center; }
  td.type_TRACE { color: silver; }
  td.type_START_TIMETRACK { color: cadetblue; }
  td.type_STOP_TIMETRACK { color: dodgerblue; }
  td.subType_WebView { color: forestgreen; background-color: palegreen; }
  td.action > span { display: block; max-width: 300px; overflow: hidden; }
  div.json-like { color: darkslateblue; cursor: pointer; }
  div.json-like:hover { color: darkblue; }
</style>`;
const scripts = `<script type="text/javascript">
  function toJSON(s) { let val = ''; try { val = JSON.parse(s); } catch (err) {} return val; }
  window.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('click', (event) => {
      const el = event.target;
      // the log contains json strings, but they are not delimited in any meaningful way
      // so we have to try hard to find "something" that looks like a json
      if (el.classList.contains('json-like')) {
        let val = toJSON(el.innerText);
        let val2;
        let s = '';
        if (val && val.message && typeof val.message === 'string') {
          s = val.message;
        }
        if (val && val.data && val.data.message && typeof val.data.message === 'string') {
          s = val.data.message;
        }
        if (s && /^[^{]+/.test(s)) {
            val2 = toJSON(s.replace(/^[^{]*{/, '{'));
        }
        console.info(val2 || val);
      }
    });
  });
</script>`;

// list page
app.get('/', (req, res) => {
  const logs = fs.readdirSync(path.join(__dirname, '/.'));
  const names = logs.filter(fn => fn.endsWith('.txt'));
  const html = '<html><body><ul>' +
    names.map(fn => `<li><a href="/${fn}">${fn}</a></li>`).join('') +
    `</ul><h2>usage</h2><ol>
      <li>?<strong>subType</strong>=WebView,Survey === subType eq OR</li>
      <li>?<strong>actionIncludes</strong>=Survey%20response,OnWebViewLoad === action includes OR</li>
      <li>?<strong>noResourceLoads</strong>=1 === skip url load info</li>
      <li>?<strong>onlyFrontendNotify</strong>=1 = show only logs sent by android frontend</li>
    </ol></body></html>`;
  res.send(html);
});

// log viewer for a given file
app.get('/:name', (req, res) => {
  const { name } = req.params;
  if (!/^[a-z-_0-9]*?\.txt$/i.test(name)) return res.status(401).send('invalid name');
  const log = fs.readFileSync(path.join(__dirname, `./${name}`), 'utf8');
  let html = `<html><head>${style}${scripts}</head><body>`;
  const lines = log.replace(/\r\n/g, '\n').split(/\n/);
  let batches = [];
  let current = { text: [] };
  let id = 0;

  // parse log into an array of objects
  lines.forEach((line, i) => {
    const typeMatcher = line.trim().match(/^\[([A-Z_]*)]/);
    const isFirstBatchLine = typeMatcher && typeMatcher.length > 1;
    if (!isFirstBatchLine) { // consecutive line
      return current.text.push(line);
    }

    line = line.replace(`[${typeMatcher[1]}]`, '');
    const timeMatcher = line.match(/^\[(\d{2}:\d{2}:\d{2})]/);
    let time = '';
    if (timeMatcher && timeMatcher.length > 1) {
      time = timeMatcher[1];
      line = line.replace(`[${timeMatcher[1]}]`, '');
    }
    const subTypeMatcher = line.match(/^\[([0-9a-z_-]*)]\s/i);
    let subType = '';
    if (subTypeMatcher && subTypeMatcher.length > 1) {
      subType = subTypeMatcher[1];
      line = line.replace(`[${subTypeMatcher[1]}]`, '').trim();
    }
    const actionMatcher = line.match(/^([a-z -_.']*) \(\/Users\//);
    let action = '';
    if (actionMatcher && actionMatcher.length > 1) {
      action = actionMatcher[1];
      line = line.replace(`${actionMatcher[1]} `, '').trim();
    }
    // example: (/Users/runner/work/1/s/PMA/PMA/WebView/Foobar.cs, LoadFile:110)
    const locationMatcher = line.match(/^\(\/Users\/runner\/(.*?):\d+\)/);
    let location = '';
    if (locationMatcher && locationMatcher.length > 1) {
      location = locationMatcher[1].replace(/^work\/\d\/s\/PMA\//, '…');
      line = line.replace(/.*?:\d+\)/, '').trim();
    }

    if (i > 0) {
      batches.push(current);
    }
    current = { type: typeMatcher[1], text: [line], subType, id: id++, time, location, lineNumber: i, action };
  });
  batches.push(current);

  // req query params
  if (req.query.subType) {
    const st = req.query.subType.trim().split(',');
    batches = batches.filter(b => st.includes(b.subType));
  }
  if (req.query.noResourceLoads) {
    batches = batches.filter(b =>
      !/(OnLoadResource|ShouldInterceptRequest|OnPageStarted|OnPageFinished) method/.test(b.action));
  }
  if (req.query.onlyFrontendNotify) { // this is only useful for android
    batches = batches.filter(b => (b.text || []).join('').includes('native://notify'));
  }
  if (req.query.actionIncludes) {
    const acs = req.query.actionIncludes.trim().split(',');
    batches = batches.filter(b => acs.some(frag => String(b.action).includes(frag)));
  }

  // final rendering
  html += '<table><tr><th>line</th><th>type</th><th>time</th><th>subtype</th>' +
    '<th>location</th><th>action</th><th>content</th></tr>';
  batches.forEach(b => {
    // let's try to split "jsonish" texts into multiple lines (the original line breaks are NOT relevant here)
    let text = '<div>' + escape(b.text.join('')) + '</div>';
    text = text.replace('native://notify?{', 'native://notify?</div><div class="json-like">{');
    text = text.replace('Data : {', 'Data : </div><div class="json-like">{');

    html += `<tr class="type_${b.type} subType_${b.subType}">
      <td class="line-number">${b.lineNumber}</td>
      <td class="type_${b.type}">${b.type}</td>
      <td class="time">${b.time}</td>
      <td class="subType_${b.subType}">${b.subType}</td>
      <td class="location">${b.location}</td>
      <td class="action"><span>${escape(b.action)}</span></td>
      <td class="content">${text}</td>
    </tr>`;
  });
  html += '</table></body></html>';
  res.send(html);
});

app.listen(port, () => {
  console.info(`Listening at http://localhost:${port}`);
});
