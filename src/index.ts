import express from 'express';
import expressWs from 'express-ws';
import cors from 'cors';
import { JsonDB, Config } from 'node-json-db';
import crypto from 'crypto';
import WebSocket from 'ws';

const PORT = 3001;

const profileColors = ["#9C3822", "#BA0616", "#0C2378", "#425FCB", "#42CB78", "#CB42A9", "#9342CB", "#65CB42"];

const exprWs = expressWs(express());
const app = exprWs.app;

const connectedUsers: { [key: string]: WebSocket; } = {};

app.use(express.json());
app.use(cors({ origin: true }));

const db = new JsonDB(new Config("database", true, false, "/"));

app.post("/authenticate", async (req, res) => {
  const { username, password } = req.body;
  var user: User | undefined = undefined;
  const hash = crypto.pbkdf2Sync(password, 'salt', 1000, 64, 'sha512').toString('hex');

  if (!await db.exists(`/users/${username}`)) {
    var color = profileColors[Math.floor(Math.random() * profileColors.length)];
    user = { username, password: hash, color, chats: [] };
    db.push(`/users/${username}`, user);
  } {
    user = await db.getObject<User>(`/users/${username}`);
    if (user.password != hash) {
      return res.status(401).send("Incorrect Credentials");
    }
  }
  return res.status(200).json({ username: user.username, color: user.color });
});

const newChatCreated = async (chatId: string, newChat: Chat, username: string, recipient: string) => {
  await db.push(`/chats/${chatId}`, newChat);
  await db.push(`/users/${username}`, {
    chats: [chatId]
  }, false);
  await db.push(`/users/${recipient}`, {
    chats: [chatId]
  }, false);
};

app.ws("/connect", async (ws, req) => {
  var username: string | undefined = undefined;
  ws.on('message', async message => {
    const msg = JSON.parse(message.toString());

    switch (msg.type) {
      case 'connect':
        {
          connectedUsers[msg.username] = ws;
          username = msg.username;
          const user = (await db.getData(`/users/${username}`)) as User;
          const chatIds = user.chats;
          const chats = await Promise.all(chatIds.map(async id => {
            const chat = (await db.getData(`/chats/${id}`)) as Chat;
            const participants = chat.participants.filter(value => value != username);
            const participantsUsers = await Promise.all(participants.map(async (puser) => {
              const participantUser = (await db.getData(`/users/${puser}`)) as User;
              return { username: participantUser.username, color: participantUser.color };
            }));
            return {
              participants: participantsUsers,
              messages: chat.messages,
              id
            };
          }));
          // users that this user has a chat with
          const friendUsers: string[] = chats.map(chat => {
            return chat.participants[0].username;
          });
          const activeUsers = friendUsers.filter(friend => friend in connectedUsers);
          ws.send(JSON.stringify({
            type: 'sync',
            chats,
            activeUsers
          }));
          for (const activeUser of activeUsers) {
            const activeUserWs = connectedUsers[activeUser];
            activeUserWs.send(JSON.stringify({
              type: 'user-connected',
              username
            }));
          }
        }
        break;
      case 'new-chat':
        {
          if (!username) return;
          const recipient = msg.recipient;
          // Check user isnt recipient
          if (recipient == username) {
            ws.send(JSON.stringify({
              type: 'new-chat-error',
              error: 'USER_AS_RECIPIENT'
            }));
            return;
          }
          // Check if recipient is a user
          if (!await db.exists(`/users/${recipient}`)) {
            ws.send(JSON.stringify({
              type: 'new-chat-error',
              error: 'UNKNOWN_RECIPIENT'
            }));
            return;
          }
          // Check if no chat with recipient
          const user = (await db.getData(`/users/${username}`)) as User;
          for (const chatId of user.chats) {
            const chat = await db.getData(`/chats/${chatId}`) as Chat;
            const chatParticipant = chat.participants.filter(p => p != username)[0];
            if (chatParticipant == recipient) {
              ws.send(JSON.stringify({
                type: 'new-chat-error',
                error: 'DUPLICATE_RECIPIENT'
              }));
              return;
            }
          }

          // Create the chat
          const recipientUser = (await db.getData(`/users/${recipient}`)) as User;
          const chatId = crypto.randomUUID();
          const newChat: Chat = {
            participants: [username, recipient],
            id: chatId,
            messages: []
          };
          const newChatUser = {
            participants: [recipientUser],
            id: chatId,
            messages: []
          };
          const newChatRecipient = {
            participants: [user],
            id: chatId,
            messages: []
          };
          await newChatCreated(chatId, newChat, username, recipient);

          // Send the confirmation
          ws.send(JSON.stringify({
            type: 'new-chat',
            chat: newChatUser,
            online: recipient in connectedUsers ? recipient : undefined,
            success: true
          }));
          connectedUsers[recipient]?.send(JSON.stringify({
            type: 'new-chat',
            chat: newChatRecipient,
            online: username in connectedUsers ? username : undefined
          }));

        }
        break;
      case 'send-message':
        {
          if (!username) return;
          const newMessage = {
            timestamp: Date.now(),
            msg: msg.msg,
            sender: username
          };
          const messages = await (db.getData(`/chats/${msg.chatId}/messages`));
          await db.push(`/chats/${msg.chatId}/messages`, [newMessage, ...messages]);

          const participants = await db.getData(`/chats/${msg.chatId}/participants`);
          const recipient = participants.filter((p: string) => p != username)[0];
          connectedUsers[recipient]?.send(JSON.stringify({
            type: 'new-message',
            message: newMessage,
            chatId: msg.chatId
          }));

        }
        break;
    }

  });
  ws.on('close', async () => {
    if (!username) return;
    delete connectedUsers[username];
    const chatIds = await db.getData(`/users/${username}/chats`);
    const chats = await Promise.all(chatIds.map(async (chatId: string) => {
      return await db.getData(`/chats/${chatId}`);
    }));
    const friendUsers = chats.map((chat: Chat) => {
      return chat.participants.filter(p => p != username)[0];
    });
    const activeFriends = friendUsers.filter(friend => friend in connectedUsers);
    for (const activeFriend of activeFriends) {
      const activeFriendWs = connectedUsers[activeFriend];
      activeFriendWs.send(JSON.stringify({
        type: 'user-disconnected',
        username
      }));
    }
  });
});

app.listen(PORT);
console.log(`Listening on port ${PORT}`);