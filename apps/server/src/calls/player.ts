import { Router, type Response } from "express";

// Watch Together's video player page: /watch/player?v=<video id>[&site=twitch|vimeo|dailymotion]
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
      // 0.7.1: Twitch, Vimeo and Dailymotion's own embed players too (each driven by its
      // documented postMessage messages; still no script of theirs on this address).
      "frame-src https://www.youtube-nocookie.com https://player.twitch.tv https://player.vimeo.com https://www.dailymotion.com https://geo.dailymotion.com",
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
// do; each site's player is driven with its own postMessage protocol:
//   YouTube: "listening", then "command" messages; answers "infoDelivery" / "onStateChange".
//   Vimeo (0.7.1): JSON {method, value}; answers {event: ready/play/pause/ended/timeupdate…}.
//   Dailymotion (0.7.1): the embed's postMessage API ("play", "seek=12"; answers "event=…&time=…").
//   Twitch (0.7.1): the embed proxy messages {namespace, eventName, params}; answers UPDATE_STATE.
// States use YouTube's numbers everywhere: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering.
const PLAYER_JS = String.raw`(function () {
  'use strict';
  var SITES = {
    youtube: { origins: ['https://www.youtube-nocookie.com'], id: /^[A-Za-z0-9_-]{11}$/ },
    vimeo: { origins: ['https://player.vimeo.com'], id: /^\d{5,12}(?::[0-9a-f]{6,20})?$/ },
    dailymotion: { origins: ['https://www.dailymotion.com', 'https://geo.dailymotion.com'], id: /^x[a-z0-9]{4,12}$/i },
    twitch: { origins: ['https://player.twitch.tv'], id: /^(v\d{5,14}|c:[A-Za-z0-9_]{3,25})$/ }
  };
  var box = document.getElementById('player');
  var frame = null;
  var site = 'youtube';
  var videoId = null;
  var heard = false;
  var listenTimer = null;
  var info = blank(0);
  var reportTimer = null;
  var native = !!(window.ReactNativeWebView && window.ReactNativeWebView.postMessage);

  function blank(start) { return { state: -1, time: start || 0, at: 0, duration: 0, title: '', author: '', muted: false, volume: 100 }; }

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
    if (info.duration > 0 && t > info.duration) t = info.duration;
    return t;
  }
  function report() {
    tell({ ev: 'state', state: STATES[String(info.state)] || 'unstarted', time: now(), duration: info.duration, title: info.title, author: info.author, muted: info.muted });
  }
  function setTime(t) { if (typeof t === 'number' && isFinite(t) && t >= 0) { info.time = t; info.at = Date.now(); } }
  function setState(s) {
    if (s === info.state) return;
    if (info.state === 1) { info.time = now(); }
    info.at = Date.now();
    info.state = s;
  }
  function hello() {
    if (heard) return;
    heard = true;
    clearInterval(listenTimer);
    tell({ ev: 'ready' });
  }
  function post(msg) {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(msg, SITES[site].origins[0]);
  }

  // ---- each site: what to load, how to send a command, how to read what it says ----
  function srcFor(id, start, play) {
    var s0 = Math.max(0, Math.floor(start || 0));
    var here = encodeURIComponent(location.origin);
    if (site === 'vimeo') {
      var parts = id.split(':');
      return 'https://player.vimeo.com/video/' + parts[0] + '?' + [
        parts[1] ? 'h=' + parts[1] : '', 'api=1', 'player_id=glofly', 'autoplay=' + (play ? 1 : 0), 'controls=0', 'dnt=1',
        'playsinline=1', 'title=0', 'byline=0', 'portrait=0', 'keyboard=0', 'pip=0'
      ].filter(Boolean).join('&') + (s0 ? '#t=' + s0 + 's' : '');
    }
    if (site === 'dailymotion') {
      return 'https://www.dailymotion.com/embed/video/' + id + '?' + [
        'api=postMessage', 'id=glofly', 'autoplay=' + (play ? 1 : 0), 'controls=0', 'mute=0', 'start=' + s0,
        'ui-logo=0', 'sharing-enable=0', 'queue-enable=0', 'queue-autoplay-next=0', 'origin=' + here
      ].join('&');
    }
    if (site === 'twitch') {
      // Twitch only plays on the addresses listed as "parent".
      var parents = [location.hostname, 'chat.glofly.app', 'glofly.app', 'localhost'];
      var q = parents.filter(function (p, i) { return p && parents.indexOf(p) === i; }).map(function (p) { return 'parent=' + encodeURIComponent(p); });
      q.push('autoplay=' + (play ? 'true' : 'false'), 'muted=false', 'controls=false');
      if (id.indexOf('c:') === 0) q.push('channel=' + encodeURIComponent(id.slice(2)));
      else {
        q.push('video=' + id);
        if (s0) q.push('time=' + Math.floor(s0 / 3600) + 'h' + Math.floor((s0 % 3600) / 60) + 'm' + (s0 % 60) + 's');
      }
      return 'https://player.twitch.tv/?' + q.join('&');
    }
    return 'https://www.youtube-nocookie.com/embed/' + id + '?' + [
      'enablejsapi=1', 'controls=0', 'disablekb=1', 'fs=0', 'iv_load_policy=3', 'rel=0',
      'playsinline=1', 'modestbranding=1', 'widgetid=1', 'autoplay=' + (play ? 1 : 0),
      'start=' + s0, 'origin=' + here, 'widget_referrer=' + here
    ].join('&');
  }

  function yt(func, args) { post(JSON.stringify({ event: 'command', func: func, args: args || [], id: 1, channel: 'widget' })); }
  function vimeo(method, value) { post(JSON.stringify(value === undefined ? { method: method } : { method: method, value: value })); }
  function dm(cmd) { post(cmd); }
  function twitch(name, params) { post({ namespace: 'twitch-embed-player-proxy', eventName: name, params: params === undefined ? null : params }); }

  function doPlay() {
    if (site === 'vimeo') vimeo('play');
    else if (site === 'dailymotion') dm('play');
    else if (site === 'twitch') twitch('play');
    else yt('playVideo');
  }
  function doPause() {
    if (site === 'vimeo') vimeo('pause');
    else if (site === 'dailymotion') dm('pause');
    else if (site === 'twitch') twitch('pause');
    else yt('pauseVideo');
  }
  function doSeek(to) {
    if (site === 'vimeo') vimeo('setCurrentTime', to);
    else if (site === 'dailymotion') dm('seek=' + to);
    else if (site === 'twitch') twitch('seek', to);
    else yt('seekTo', [to, true]);
    setTime(to);
  }
  function doVolume(vol, muted) {
    if (typeof vol === 'number') {
      var v = Math.max(0, Math.min(100, Math.round(vol)));
      if (site === 'vimeo') vimeo('setVolume', v / 100);
      else if (site === 'dailymotion') dm('volume=' + v / 100);
      else if (site === 'twitch') twitch('setVolume', v / 100);
      else yt('setVolume', [v]);
    }
    if (muted === true || muted === false) {
      if (site === 'vimeo') vimeo('setMuted', muted);
      else if (site === 'dailymotion') dm('muted=' + (muted ? 1 : 0));
      else if (site === 'twitch') twitch('setMuted', muted);
      else yt(muted ? 'mute' : 'unMute');
      info.muted = muted;
    }
  }

  function load(s, id, start, play) {
    if (!SITES[s] || !SITES[s].id.test(id)) return;
    site = s;
    videoId = id;
    heard = false;
    info = blank(start);
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.src = srcFor(id, start, play);
    frame.title = 'Shared video';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.referrerPolicy = 'strict-origin';
    frame.addEventListener('load', listen);
    box.appendChild(frame);
  }

  // YouTube's player starts talking once it hears "listening" (sent until it answers). Vimeo
  // says "ready" by itself, Dailymotion "apiready", Twitch sends its state.
  function listen() {
    clearInterval(listenTimer);
    if (site !== 'youtube') return;
    var tries = 0;
    var once = function () {
      // Up to two minutes: YouTube's player can take a while to start on a slow computer.
      if (heard || tries++ > 480 || !frame || !frame.contentWindow) return clearInterval(listenTimer);
      post(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }));
    };
    once();
    listenTimer = setInterval(once, 250);
  }

  function fromYouTube(data) {
    if (!heard) {
      hello();
      yt('addEventListener', ['onStateChange']);
      yt('addEventListener', ['onError']);
    }
    var i = data.info;
    if ((data.event === 'infoDelivery' || data.event === 'initialDelivery') && i && typeof i === 'object') {
      if (typeof i.playerState === 'number') setState(i.playerState);
      setTime(i.currentTime);
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
  }

  function fromVimeo(data) {
    var ev = data.event;
    var d = data.data && typeof data.data === 'object' ? data.data : {};
    if (ev === 'ready') {
      hello();
      ['play', 'pause', 'ended', 'timeupdate', 'bufferstart', 'bufferend', 'volumechange', 'error', 'loaded'].forEach(function (e) { vimeo('addEventListener', e); });
      vimeo('getDuration');
      vimeo('getVideoTitle');
      vimeo('getMuted');
      return;
    }
    if (data.method === 'getDuration' && typeof data.value === 'number') info.duration = data.value;
    else if (data.method === 'getVideoTitle' && typeof data.value === 'string') info.title = data.value.slice(0, 200);
    else if (data.method === 'getMuted' && typeof data.value === 'boolean') info.muted = data.value;
    if (typeof d.seconds === 'number') setTime(d.seconds);
    if (typeof d.duration === 'number' && d.duration > 0) info.duration = d.duration;
    if (ev === 'play') { setState(1); report(); }
    else if (ev === 'pause') { setState(2); report(); }
    else if (ev === 'ended') { setState(0); report(); }
    else if (ev === 'bufferstart') setState(3);
    else if (ev === 'bufferend') setState(info.state === 3 ? 1 : info.state);
    else if (ev === 'timeupdate' && info.state !== 1 && info.state !== 0) setState(1);
    else if (ev === 'volumechange') { if (typeof d.muted === 'boolean') info.muted = d.muted; else vimeo('getMuted'); }
    else if (ev === 'error') tell({ ev: 'error', code: 5 });
  }

  function fromDailymotion(text) {
    var q = {};
    text.split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq > 0) { try { q[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1)); } catch (err) { /* skip */ } }
    });
    var ev = q.event;
    if (!ev) return;
    if (ev === 'apiready') hello();
    else if (!heard) hello();
    if (q.time !== undefined) setTime(Number(q.time));
    if (q.duration !== undefined && Number(q.duration) > 0) info.duration = Number(q.duration);
    if (q.muted !== undefined) info.muted = q.muted === 'true' || q.muted === '1';
    if (q.title) info.title = String(q.title).slice(0, 200);
    if (ev === 'playing' || ev === 'play') { setState(1); report(); }
    else if (ev === 'pause') { setState(2); report(); }
    else if (ev === 'ended' || ev === 'video_end') { setState(0); report(); }
    else if (ev === 'waiting') setState(3);
    else if (ev === 'error') tell({ ev: 'error', code: 5 });
  }

  var TWITCH_STATES = { Idle: -1, Ready: 5, Buffering: 3, Playing: 1, Paused: 2, Ended: 0 };
  function fromTwitch(data) {
    if (!data || data.namespace !== 'twitch-embed-player-proxy') return;
    hello();
    var p = data.params;
    if (data.eventName === 'UPDATE_STATE' && p && typeof p === 'object') {
      setTime(p.currentTime);
      if (typeof p.duration === 'number' && isFinite(p.duration) && p.duration > 0) info.duration = p.duration;
      if (typeof p.muted === 'boolean') info.muted = p.muted;
      if (typeof p.playback === 'string' && TWITCH_STATES[p.playback] !== undefined) {
        var before = info.state;
        setState(TWITCH_STATES[p.playback]);
        if (before !== info.state) report();
      }
      if (p.videoID === undefined && typeof p.channelName === 'string' && !info.title) info.title = p.channelName.slice(0, 100);
    }
  }

  window.addEventListener('message', function (e) {
    // From the site's player.
    if (frame && e.source === frame.contentWindow && SITES[site].origins.indexOf(e.origin) >= 0) {
      var data = e.data;
      if (site === 'dailymotion' && typeof data === 'string' && data.indexOf('event=') >= 0) return fromDailymotion(data);
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (err) { return; } }
      if (!data || typeof data !== 'object') return;
      if (site === 'vimeo') fromVimeo(data);
      else if (site === 'twitch') fromTwitch(data);
      else if (site === 'youtube') fromYouTube(data);
      return;
    }
    // From the app (only the page that holds this one).
    if (!native && e.source === window.parent) command(e.data);
  });

  function command(c) {
    if (!c || typeof c !== 'object' || c.glofly !== 'watch') return;
    var to = Number(c.to);
    switch (c.cmd) {
      case 'load':
        if (typeof c.videoId === 'string') load(typeof c.site === 'string' && SITES[c.site] ? c.site : 'youtube', c.videoId, Number(c.start) || 0, !!c.play);
        break;
      case 'play': doPlay(); break;
      case 'pause': doPause(); break;
      case 'seek':
        if (isFinite(to) && to >= 0) doSeek(to);
        break;
      case 'volume':
        doVolume(isFinite(Number(c.volume)) && c.volume !== undefined && c.volume !== null ? Number(c.volume) : undefined, c.muted);
        break;
    }
  }
  // Phone apps call this from their web view.
  window.gloflyWatch = command;

  // A quick report a few times a second, so the app knows how far along the video really is.
  reportTimer = setInterval(function () { if (heard) report(); }, 400);

  var first = new URLSearchParams(location.search);
  var v = first.get('v');
  var fs = first.get('site') || 'youtube';
  if (v && SITES[fs] && SITES[fs].id.test(v)) load(fs, v, Number(first.get('t')) || 0, first.get('play') === '1');
  tell({ ev: 'loaded' });
})();
`;
