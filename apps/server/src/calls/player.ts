import { Router, type Response } from "express";

// Watch Together's video player page: /watch/player?v=<YouTube id>
//
// Every app shows the shared video through this little page (an iframe in the desktop app and
// the browser version, a web view in the phone apps). It holds YouTube's own embed player and
// passes simple commands to it (play, pause, skip, volume) and its state back (time, playing,
// length) — using YouTube's documented message protocol directly, so no script from YouTube (or
// anyone else) ever runs on this server's address. Only this page's own small script does, and
// it never asks the server for anything.
//
// Why a page here rather than YouTube's player straight in the app: YouTube refuses to play in a
// page with no web address of its own (the desktop app's window is a file on the computer, and
// a phone's web view has none either: "Error 153"). This page has a real https address, so
// YouTube sees where it's embedded, and the same page works in all three apps.

export const watchPageRouter = Router();

/** Headers for the player page: tight, but embeddable, and it tells YouTube where it is. */
function playerHeaders(res: Response, kind: "html" | "js"): void {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'unsafe-inline'",
      "frame-src https://www.youtube-nocookie.com",
      "img-src 'self' data:",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; "),
  );
  // The apps embed it (chat.glofly.app, the desktop app's window, Expo's web build): anyone may,
  // it only plays a YouTube video.
  res.removeHeader("X-Frame-Options");
  // YouTube needs to see this page's address (only the address, never the path or the video).
  res.setHeader("Referrer-Policy", "strict-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.removeHeader("Cross-Origin-Opener-Policy");
  res.setHeader("Cache-Control", kind === "html" ? "no-cache" : "public, max-age=300");
  res.type(kind === "html" ? "html" : "application/javascript");
}

watchPageRouter.get("/player", (_req, res) => {
  playerHeaders(res, "html");
  res.send(PLAYER_HTML);
});

watchPageRouter.get("/player.js", (_req, res) => {
  playerHeaders(res, "js");
  res.send(PLAYER_JS);
});

const PLAYER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="referrer" content="strict-origin">
<title>Glofly · Watch together</title>
<style>
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
#player, #player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<div id="player"></div>
<script src="player.js"></script>
</body>
</html>
`;

// Plain old JavaScript (no build step, runs in every browser and web view). The app says what to
// do; YouTube's player is driven with its own postMessage protocol ("listening", then
// "command" messages; it answers with "infoDelivery" / "onStateChange" / "onError").
const PLAYER_JS = String.raw`(function () {
  'use strict';
  var YT_ORIGIN = 'https://www.youtube-nocookie.com';
  var ID = /^[A-Za-z0-9_-]{11}$/;
  var box = document.getElementById('player');
  var frame = null;
  var videoId = null;
  var heard = false;
  var listenTimer = null;
  var info = { state: -1, time: 0, at: 0, duration: 0, title: '', author: '', muted: false, volume: 100 };
  var reportTimer = null;
  var native = !!(window.ReactNativeWebView && window.ReactNativeWebView.postMessage);

  // To the app: the desktop app or browser version (this page is in their iframe), or a phone
  // app's web view. Nothing secret is ever sent: only the player's state.
  function tell(msg) {
    msg.glofly = 'watch';
    if (native) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    else if (window.parent !== window) window.parent.postMessage(msg, '*');
  }

  var STATES = { '-1': 'unstarted', '0': 'ended', '1': 'playing', '2': 'paused', '3': 'buffering', '5': 'cued' };
  function now() {
    var t = info.time;
    if (info.state === 1 && info.at) t += (Date.now() - info.at) / 1000;
    return t;
  }
  function report() {
    tell({ ev: 'state', state: STATES[String(info.state)] || 'unstarted', time: now(), duration: info.duration, title: info.title, author: info.author, muted: info.muted });
  }

  function yt(func, args) {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [], id: 1, channel: 'widget' }), YT_ORIGIN);
  }

  function load(id, start, play) {
    if (!ID.test(id)) return;
    videoId = id;
    heard = false;
    info = { state: -1, time: start || 0, at: 0, duration: 0, title: '', author: '', muted: false, volume: 100 };
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    var q = [
      'enablejsapi=1', 'controls=0', 'disablekb=1', 'fs=0', 'iv_load_policy=3', 'rel=0',
      'playsinline=1', 'modestbranding=1', 'widgetid=1', 'autoplay=' + (play ? 1 : 0),
      'start=' + Math.max(0, Math.floor(start || 0)),
      'origin=' + encodeURIComponent(location.origin),
      'widget_referrer=' + encodeURIComponent(location.origin)
    ].join('&');
    frame.src = YT_ORIGIN + '/embed/' + id + '?' + q;
    frame.title = 'YouTube video';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    frame.referrerPolicy = 'strict-origin';
    frame.addEventListener('load', listen);
    box.appendChild(frame);
  }

  // YouTube's player starts talking once it hears "listening" (sent until it answers).
  function listen() {
    clearInterval(listenTimer);
    var tries = 0;
    var once = function () {
      if (heard || tries++ > 40 || !frame || !frame.contentWindow) return clearInterval(listenTimer);
      frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN);
    };
    once();
    listenTimer = setInterval(once, 250);
  }

  window.addEventListener('message', function (e) {
    // From YouTube's player.
    if (e.origin === YT_ORIGIN && frame && e.source === frame.contentWindow) {
      var data;
      try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
      if (!data || typeof data !== 'object') return;
      if (!heard) { heard = true; clearInterval(listenTimer); tell({ ev: 'ready' }); }
      var i = data.info;
      if ((data.event === 'infoDelivery' || data.event === 'initialDelivery') && i && typeof i === 'object') {
        if (typeof i.currentTime === 'number') { info.time = i.currentTime; info.at = Date.now(); }
        if (typeof i.playerState === 'number') setState(i.playerState);
        if (typeof i.duration === 'number' && i.duration > 0) info.duration = i.duration;
        if (typeof i.muted === 'boolean') info.muted = i.muted;
        if (i.videoData && typeof i.videoData === 'object') {
          if (typeof i.videoData.title === 'string') info.title = i.videoData.title.slice(0, 200);
          if (typeof i.videoData.author === 'string') info.author = i.videoData.author.slice(0, 100);
        }
      } else if (data.event === 'onStateChange' && typeof i === 'number') {
        setState(i);
        report();
      } else if (data.event === 'onError') {
        tell({ ev: 'error', code: typeof i === 'number' ? i : 0 });
      }
      return;
    }
    // From the app (only the page that holds this one).
    if (!native && e.source === window.parent) command(e.data);
  });

  function setState(s) {
    if (s === info.state) return;
    if (info.state === 1) { info.time = now(); }
    info.at = Date.now();
    info.state = s;
  }

  function command(c) {
    if (!c || typeof c !== 'object' || c.glofly !== 'watch') return;
    var to = Number(c.to);
    switch (c.cmd) {
      case 'load':
        if (typeof c.videoId === 'string') load(c.videoId, Number(c.start) || 0, !!c.play);
        break;
      case 'play': yt('playVideo'); break;
      case 'pause': yt('pauseVideo'); break;
      case 'seek':
        if (isFinite(to) && to >= 0) { yt('seekTo', [to, true]); info.time = to; info.at = Date.now(); }
        break;
      case 'volume':
        if (isFinite(Number(c.volume))) yt('setVolume', [Math.max(0, Math.min(100, Math.round(Number(c.volume))))]);
        if (c.muted === true) yt('mute'); else if (c.muted === false) yt('unMute');
        break;
    }
  }
  // Phone apps call this from their web view.
  window.gloflyWatch = command;

  // A quick report a few times a second, so the app knows how far along the video really is.
  reportTimer = setInterval(function () { if (heard) report(); }, 400);

  var first = new URLSearchParams(location.search);
  var v = first.get('v');
  if (v && ID.test(v)) load(v, Number(first.get('t')) || 0, first.get('play') === '1');
  tell({ ev: 'loaded' });
})();
`;
