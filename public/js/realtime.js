window.CassosRealtime = (() => {
  function connect() {
    if (window.io) {
      return createSocketIoAdapter();
    }
    return createWebSocketAdapter();
  }

  function createSocketIoAdapter() {
    const socket = window.io();
    return {
      emit(event, payload, reply) {
        socket.emit(event, payload, reply);
      },
      on(event, handler) {
        socket.on(event, handler);
      }
    };
  }

  function createWebSocketAdapter() {
    const listeners = new Map();
    const replies = new Map();
    const queue = [];
    let nextRequestId = 1;
    let socket = null;

    open();

    function open() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

      socket.addEventListener("open", () => {
        emitLocal("connect");
        while (queue.length) {
          socket.send(queue.shift());
        }
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.requestId && replies.has(message.requestId)) {
          const reply = replies.get(message.requestId);
          replies.delete(message.requestId);
          reply(message.response);
          return;
        }
        if (message.event) {
          emitLocal(message.event, message.payload);
        }
      });

      socket.addEventListener("close", () => {
        setTimeout(open, 1200);
      });
    }

    function emitLocal(event, payload) {
      for (const handler of listeners.get(event) || []) {
        handler(payload);
      }
    }

    return {
      emit(event, payload, reply) {
        const requestId = `r${nextRequestId++}`;
        if (reply) {
          replies.set(requestId, reply);
        }
        const serialized = JSON.stringify({ event, payload, requestId });
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(serialized);
        } else {
          queue.push(serialized);
        }
      },
      on(event, handler) {
        if (!listeners.has(event)) {
          listeners.set(event, []);
        }
        listeners.get(event).push(handler);
      }
    };
  }

  return { connect };
})();
