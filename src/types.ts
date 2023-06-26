interface User {
  username: string;
  password: string;
  color: string;
  chats: string[];
}

interface Chat {
  id: string;
  participants: string[];
  messages: Message[];
}

interface Message {
  timestamp: number;
  msg: string;
  sender: string;
}