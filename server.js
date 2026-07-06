const express = require("express");
const http = require("http");
const path = require("path");
const QRCode = require("qrcode");
const { Server } = require("socket.io");
const { createGameStore } = require("./src/gameStore");
const questions = require("./data/questions.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const store = createGameStore(questions);
const port = Number(process.env.PORT || 3000);

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_request, response) => {
  response.sendFile(path.join(__dirname, "public", "host.html"));
});

app.get("/host", (_request, response) => {
  response.sendFile(path.join(__dirname, "public", "host.html"));
});

app.get("/play", (_request, response) => {
  response.sendFile(path.join(__dirname, "public", "player.html"));
});

app.get("/join/:code", (request, response) => {
  response.redirect(`/play?code=${encodeURIComponent(request.params.code)}`);
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    questions: questions.length
  });
});

app.get("/api/games/:code/qr.svg", async (request, response, next) => {
  try {
    const code = String(request.params.code || "").trim().toUpperCase();
    const joinUrl = `${request.protocol}://${request.get("host")}${joinPath(code)}`;
    const svg = await QRCode.toString(joinUrl, {
      type: "svg",
      margin: 0,
      width: 280,
      color: {
        dark: "#000000",
        light: "#00000000"
      }
    });

    response.type("image/svg+xml").send(svg);
  } catch (error) {
    next(error);
  }
});

io.on("connection", (socket) => {
  socket.on("host:createGame", (_payload, reply) => {
    handleSocket(reply, () => {
      const game = store.createGame(socket.id);
      socket.join(hostRoom(game.code));
      emitGame(game);
      return {
        state: store.getHostState(game),
        joinUrl: joinPath(game.code)
      };
    });
  });

  socket.on("host:resumeGame", (payload, reply) => {
    handleSocket(reply, () => {
      const game = store.attachHost(payload && payload.code, socket.id);
      socket.join(hostRoom(game.code));
      emitGame(game);
      return {
        state: store.getHostState(game),
        joinUrl: joinPath(game.code)
      };
    });
  });

  socket.on("host:startGame", (payload, reply) => {
    handleSocket(reply, () => {
      const game = store.startGame(payload && payload.code, {
        questionCount: payload && payload.questionCount
      });
      emitGame(game);
      return { state: store.getHostState(game) };
    });
  });

  socket.on("host:nextQuestion", (payload, reply) => {
    handleSocket(reply, () => {
      const game = store.nextQuestion(payload && payload.code);
      emitGame(game);
      return { state: store.getHostState(game) };
    });
  });

  socket.on("host:revealAnswer", (payload, reply) => {
    handleSocket(reply, () => {
      const game = store.revealAnswer(payload && payload.code);
      emitGame(game);
      return { state: store.getHostState(game) };
    });
  });

  socket.on("host:resetGame", (payload, reply) => {
    handleSocket(reply, () => {
      const game = store.resetGame(payload && payload.code);
      emitGame(game);
      return { state: store.getHostState(game) };
    });
  });

  socket.on("host:removePlayer", (payload, reply) => {
    handleSocket(reply, () => {
      const game = store.removePlayer(payload && payload.code, payload && payload.token);
      emitGame(game);
      return { state: store.getHostState(game) };
    });
  });

  socket.on("player:joinGame", (payload, reply) => {
    handleSocket(reply, () => {
      const { game, player } = store.joinPlayer(
        payload && payload.code,
        payload && payload.name,
        payload && payload.token,
        socket.id
      );
      socket.join(playerRoom(game.code));
      emitGame(game);
      return {
        token: player.token,
        state: store.getPlayerState(game, player.token)
      };
    });
  });

  socket.on("player:submitAnswer", (payload, reply) => {
    handleSocket(reply, () => {
      const game = store.submitAnswer(payload && payload.code, payload && payload.token, payload && payload.answerIndex);
      emitGame(game);
      return {
        state: store.getPlayerState(game, payload && payload.token)
      };
    });
  });

  socket.on("disconnect", () => {
    const affectedGames = store.disconnectSocket(socket.id);
    for (const game of affectedGames) {
      emitGame(game);
    }
  });
});

function emitGame(game) {
  io.to(hostRoom(game.code)).emit("host:state", {
    state: store.getHostState(game),
    joinUrl: joinPath(game.code)
  });

  for (const player of game.players.values()) {
    if (player.socketId) {
      io.to(player.socketId).emit("player:state", {
        state: store.getPlayerState(game, player.token)
      });
    }
  }
}

function handleSocket(reply, action) {
  try {
    const payload = action();
    if (typeof reply === "function") {
      reply({ ok: true, ...payload });
    }
  } catch (error) {
    if (typeof reply === "function") {
      reply({ ok: false, error: error.message });
    }
  }
}

function hostRoom(code) {
  return `host:${code}`;
}

function playerRoom(code) {
  return `players:${code}`;
}

function joinPath(code) {
  return `/play?code=${encodeURIComponent(code)}`;
}

server.listen(port, () => {
  console.log(`Questions pour des Cassos 2.0 pret sur http://localhost:${port}`);
});
