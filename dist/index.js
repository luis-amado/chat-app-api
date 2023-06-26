"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_ws_1 = __importDefault(require("express-ws"));
const cors_1 = __importDefault(require("cors"));
const node_json_db_1 = require("node-json-db");
const crypto_1 = __importDefault(require("crypto"));
const PORT = 3001;
const profileColors = ["#9C3822", "#BA0616", "#0C2378", "#425FCB", "#42CB78", "#CB42A9", "#9342CB", "#65CB42"];
const exprWs = (0, express_ws_1.default)((0, express_1.default)());
const app = exprWs.app;
const connectedUsers = {};
app.use(express_1.default.json());
app.use((0, cors_1.default)({ origin: true }));
const db = new node_json_db_1.JsonDB(new node_json_db_1.Config("database", true, false, "/"));
app.post("/authenticate", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { username, password } = req.body;
    var user = undefined;
    const hash = crypto_1.default.pbkdf2Sync(password, 'salt', 1000, 64, 'sha512').toString('hex');
    if (!(yield db.exists(`/users/${username}`))) {
        var color = profileColors[Math.floor(Math.random() * profileColors.length)];
        user = { username, password: hash, color, chats: [] };
        db.push(`/users/${username}`, user);
    }
    {
        user = yield db.getObject(`/users/${username}`);
        if (user.password != hash) {
            return res.status(401).send("Incorrect Credentials");
        }
    }
    return res.status(200).json({ username: user.username, color: user.color });
}));
const newChatCreated = (chatId, newChat, username, recipient) => __awaiter(void 0, void 0, void 0, function* () {
    yield db.push(`/chats/${chatId}`, newChat);
    yield db.push(`/users/${username}`, {
        chats: [chatId]
    }, false);
    yield db.push(`/users/${recipient}`, {
        chats: [chatId]
    }, false);
});
app.ws("/connect", (ws, req) => __awaiter(void 0, void 0, void 0, function* () {
    var username = undefined;
    ws.on('message', (message) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const msg = JSON.parse(message.toString());
        switch (msg.type) {
            case 'connect':
                {
                    connectedUsers[msg.username] = ws;
                    username = msg.username;
                    const user = (yield db.getData(`/users/${username}`));
                    const chatIds = user.chats;
                    const chats = yield Promise.all(chatIds.map((id) => __awaiter(void 0, void 0, void 0, function* () {
                        const chat = (yield db.getData(`/chats/${id}`));
                        const participants = chat.participants.filter(value => value != username);
                        const participantsUsers = yield Promise.all(participants.map((puser) => __awaiter(void 0, void 0, void 0, function* () {
                            const participantUser = (yield db.getData(`/users/${puser}`));
                            return { username: participantUser.username, color: participantUser.color };
                        })));
                        return {
                            participants: participantsUsers,
                            messages: chat.messages,
                            id
                        };
                    })));
                    // users that this user has a chat with
                    const friendUsers = chats.map(chat => {
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
                    if (!username)
                        return;
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
                    if (!(yield db.exists(`/users/${recipient}`))) {
                        ws.send(JSON.stringify({
                            type: 'new-chat-error',
                            error: 'UNKNOWN_RECIPIENT'
                        }));
                        return;
                    }
                    // Check if no chat with recipient
                    const user = (yield db.getData(`/users/${username}`));
                    for (const chatId of user.chats) {
                        const chat = yield db.getData(`/chats/${chatId}`);
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
                    const recipientUser = (yield db.getData(`/users/${recipient}`));
                    const chatId = crypto_1.default.randomUUID();
                    const newChat = {
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
                    yield newChatCreated(chatId, newChat, username, recipient);
                    // Send the confirmation
                    ws.send(JSON.stringify({
                        type: 'new-chat',
                        chat: newChatUser,
                        online: recipient in connectedUsers ? recipient : undefined,
                        success: true
                    }));
                    (_a = connectedUsers[recipient]) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify({
                        type: 'new-chat',
                        chat: newChatRecipient,
                        online: username in connectedUsers ? username : undefined
                    }));
                }
                break;
            case 'send-message':
                {
                    if (!username)
                        return;
                    const newMessage = {
                        timestamp: Date.now(),
                        msg: msg.msg,
                        sender: username
                    };
                    const messages = yield (db.getData(`/chats/${msg.chatId}/messages`));
                    yield db.push(`/chats/${msg.chatId}/messages`, [newMessage, ...messages]);
                    const participants = yield db.getData(`/chats/${msg.chatId}/participants`);
                    const recipient = participants.filter((p) => p != username)[0];
                    (_b = connectedUsers[recipient]) === null || _b === void 0 ? void 0 : _b.send(JSON.stringify({
                        type: 'new-message',
                        message: newMessage,
                        chatId: msg.chatId
                    }));
                }
                break;
        }
    }));
    ws.on('close', () => __awaiter(void 0, void 0, void 0, function* () {
        if (!username)
            return;
        delete connectedUsers[username];
        const chatIds = yield db.getData(`/users/${username}/chats`);
        const chats = yield Promise.all(chatIds.map((chatId) => __awaiter(void 0, void 0, void 0, function* () {
            return yield db.getData(`/chats/${chatId}`);
        })));
        const friendUsers = chats.map((chat) => {
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
    }));
}));
app.listen(PORT);
console.log(`Listening on port ${PORT}`);
