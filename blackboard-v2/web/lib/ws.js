// One WebSocket with auto-reconnect and exponential backoff.
export function connectWs({ onMessage, onStatus }) {
  let ws = null, timer = null, ping = null, tries = 0, stopped = false;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/board/api/ws');
    ws.onopen = () => {
      tries = 0;
      onStatus('open');
      ping = setInterval(() => { try { ws.send('{"type":"ping"}'); } catch {} }, 25000);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      onMessage(m);
    };
    ws.onclose = () => {
      clearInterval(ping);
      if (stopped) return;
      onStatus('closed');
      const delay = Math.min(30000, 500 * 2 ** tries++) + Math.random() * 300;
      timer = setTimeout(open, delay);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  open();
  return () => { stopped = true; clearTimeout(timer); clearInterval(ping); try { ws.close(); } catch {} };
}
