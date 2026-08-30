import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

let mail = new MailComposer({
    from: 'test@test.com',
    to: 'test2@test.com',
    subject: 'hello',
    text: 'world'
});
mail.compile().build((err, message) => {
    console.log("Raw message:", message.toString());
});
