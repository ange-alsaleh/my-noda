// index.js  (ESM)

import TelegramBot from 'node-telegram-bot-api';
import { initializeApp as initClientApp } from 'firebase/app';
import { getDatabase as getClientDB, ref as clientRef, onChildAdded, push as clientPush, get as clientGet, child } from 'firebase/database';
import admin from 'firebase-admin';
import fs from 'fs';

// ===== 1) إعدادات Firebase (Client SDK) =====
const firebaseConfig = {
  apiKey: "AIzaSyAwjmWIOyvGKUAXqDKpzpouZ-MlyuhYjMc",
  authDomain: "support-chat-31aa6.firebaseapp.com",
  databaseURL: "https://support-chat-31aa6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "support-chat-31aa6",
  storageBucket: "support-chat-31aa6.appspot.com",
  messagingSenderId: "1079004120541",
  appId: "1:1079004120541:web:4a11ee42427c6e9be1e234",
  measurementId: "G-8NNELSESB8"
};
const clientApp = initClientApp(firebaseConfig);
const clientDb = getClientDB(clientApp);

// ===== 2) Firebase Admin (للإشعارات) =====
const serviceAccountPath = new URL('./serviceAccountKey.json', import.meta.url);
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: firebaseConfig.databaseURL
});
const adminDb = admin.database();
const messaging = admin.messaging();

// ===== 3) إعدادات بوت التليجرام =====
const BOT_TOKEN = '7886097727:AAGs5oUKdv080NYwduN17AV43CPWUySULXA';
const ADMIN_CHAT_IDS = ['789618123']; // تقدر تضيف أكثر من آيد

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/** أداة مساعدة لإرسال إشعار Push لزبون معيّن */
async function sendPushToChat(chatId, bodyText) {
  try {
    const snap = await adminDb.ref(`userTokens/${chatId}`).once('value');
    const token = snap.val();
    if (!token) {
      console.log(`لا يوجد FCM token لـ ${chatId}`);
      return;
    }
    const msg = {
      token,
      notification: {
        title: "رد جديد من الدعم الفني",
        body: bodyText
      },
      data: { chatId }
    };
    await messaging.send(msg);
    console.log(`✓ تم إرسال إشعار للزبون ${chatId}`);
  } catch (e) {
    console.error('FCM error:', e);
  }
}

/** 4) متابعة رسائل الزباين وإرسال نسخة للتليجرام */
const processed = new Set(); // لتفادي التكرار عند إعادة التشغيل

// نراقب كل محادثة جديدة
const rootRef = clientRef(clientDb, 'supportMessages');
onChildAdded(rootRef, (chatSnap) => {
  const chatId = chatSnap.key;
  const msgsRef = clientRef(clientDb, `supportMessages/${chatId}`);

  // نراقب أي رسالة جديدة داخل هذه المحادثة
  onChildAdded(msgsRef, (msgSnap) => {
    const key = `${chatId}/${msgSnap.key}`;
    if (processed.has(key)) return;
    processed.add(key);

    const data = msgSnap.val();
    if (!data) return;

    // فقط رسائل الزبون تذهب للادمن
    if (data.sender === 'user') {
      const text = `رسالة جديدة من محادثة ${chatId}:\n${data.message}`;
      ADMIN_CHAT_IDS.forEach(id => bot.sendMessage(id, text).catch(console.error));
    }
  });
});

/** 5) أوامر الرد من التليجرام */
bot.on('message', async (msg) => {
  const chatIdTG = msg.chat.id;
  const text = msg.text || '';

  // أمر الرد: /reply chatId النص…
  if (text.startsWith('/reply')) {
    const parts = text.trim().split(' ');
    if (parts.length >= 3) {
      const targetChatId = parts[1];
      const replyText = parts.slice(2).join(' ');

      try {
        // اكتب الرد في قاعدة البيانات (لكي يظهر للعميل في صفحته)
        await clientPush(clientRef(clientDb, `supportMessages/${targetChatId}`), {
          sender: 'admin',
          message: replyText,
          timestamp: Date.now()
        });

        // إشعار Push
        await sendPushToChat(targetChatId, replyText);

        await bot.sendMessage(chatIdTG, '✓ تم إرسال الرد.');
      } catch (e) {
        console.error(e);
        await bot.sendMessage(chatIdTG, 'حدث خطأ أثناء الإرسال.');
      }
    } else {
      bot.sendMessage(chatIdTG, 'الاستخدام الصحيح:\n/reply chatId نص الرسالة');
    }
    return;
  }

  // (اختياري) أي رسائل أخرى من الادمن تتجاهل أو تعاملها كما تحب
});
