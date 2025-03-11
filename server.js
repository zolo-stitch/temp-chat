const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;
const chats = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get(['/', '/chat/:chatId'], (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const chatId = req.url.split('/chat/')[1]?.trim();
  if (!chatId || chatId.length < 10) {
    ws.close(1008, 'Invalid chat ID');
    return;
  }

  if (!chats.has(chatId)) {
    chats.set(chatId, { clients: new Map(), messages: [] });
  }
  const chat = chats.get(chatId);

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (err) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }

    const actions = {
      join: () => {
        if (chat.clients.has(data.user)) {
          return ws.send(JSON.stringify({ type: 'error', message: 'User already exists in chat' }));
        }
        chat.clients.set(data.user, ws);
        ws.send(JSON.stringify({ type: 'chatStatus', messages: chat.messages, users: [...chat.clients.keys()] }));
        broadcast(chat, { type: 'userJoined', user: data.user }, data.user);
      },
      message: () => {
        if (!chat.clients.has(data.from)) return;
        const msgObj = { from: data.from, message: data.message, timestamp: Date.now() };
        chat.messages.push(msgObj);
        broadcast(chat, { type: 'message', ...msgObj });
      },
      videoStarted: () => broadcast(chat, { type: 'videoStarted', user: data.user }, data.user),
      videoStopped: () => broadcast(chat, { type: 'videoStopped', user: data.user }, data.user),
      offer: () => sendToUser(chat, data.to, data),
      answer: () => sendToUser(chat, data.to, data),
      'ice-candidate': () => sendToUser(chat, data.to, data),
      leave: () => handleDisconnect(chat, data.user, ws),
    };

    if (actions[data.type]) {
      actions[data.type]();
    } else {
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  });

  ws.on('close', () => {
    for (const [user, client] of chat.clients) {
      if (client === ws) {
        handleDisconnect(chat, user, ws);
        break;
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    ws.close();
  });
});

const broadcast = (chat, msg, excludeUser) => {
  chat.clients.forEach((client, user) => {
    if (client.readyState === WebSocket.OPEN && user !== excludeUser) {
      client.send(JSON.stringify(msg));
    }
  });
};

const sendToUser = (chat, toUser, msg) => {
  const client = chat.clients.get(toUser);
  if (client?.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(msg));
  }
};

const handleDisconnect = (chat, user, ws) => {
  if (chat.clients.get(user) === ws) {
    chat.clients.delete(user);
    broadcast(chat, { type: 'userLeft', user }, user);
    if (chat.clients.size === 0) {
      chats.delete(chatId); // Fixed: Use chatId from outer scope
    }
  }
};