// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

// Connect to MongoDB Atlas using the connection string stored in the MONGODB_URI environment variable
const mongoURI = process.env.MONGODB_URI; // Make sure to set this in your .env file with your full connection string
mongoose.connect(mongoURI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ Error connecting to MongoDB Atlas:', err));

// Define the Ticket schema
const ticketSchema = new mongoose.Schema({
    email: { type: String, required: true },
    ticketId: { type: String, required: true },
    purchaseDatetime: { type: String, required: true },
    stripeSessionId: { type: String, required: true },
    scanned: { type: Boolean, default: false },
});

// Nodemailer transporter configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// Helper function to generate a PDF ticket with a QR code
async function generateTicketPDF(ticket) {
    let buffers = [];
    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });

    // Collect PDF data in memory
    doc.on('data', (chunk) => buffers.push(chunk));
    const endPromise = new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));
    });

    // 1. Add the logo at the top (centered)
    const logoWidth = 150;
    const logoX = (doc.page.width - logoWidth) / 2;
    doc.image('images/karawan-logo.png', logoX, 20, { width: logoWidth });

    // Move down to create space after the logo
    doc.moveDown(10);

    // 2. Add the Date and Location text, center-aligned
    const eventInfo = "26. April 2025 at 23:30 - 27 April 2025 at 6:00\nApoteca, 12 Rue de la Boucherie, 1247 Ville-Haute Luxembourg, Luxemburg";
    doc.fontSize(12).text(eventInfo, {
        align: 'center',
        width: doc.page.width - 100
    });

    doc.moveDown(1);

    // 3. Add the Ticket ID text, center-aligned
    doc.fontSize(14).text(`Ticket ID: ${ticket.ticketId}`, {
        align: 'center'
    });

    doc.moveDown(2);

    // 4. Generate a QR code from the ticket ID and embed it (larger size)
    const qrDataURL = await QRCode.toDataURL(ticket.ticketId);
    const qrCodeSize = 200;
    const qrX = (doc.page.width - qrCodeSize) / 2;
    doc.image(qrDataURL, qrX, doc.y, { fit: [qrCodeSize, qrCodeSize] });

    // Finalize the PDF document
    doc.end();

    return endPromise;
}

// Create the Ticket model
const Ticket = mongoose.model('Ticket', ticketSchema);

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');

// Parse JSON request bodies
app.use(express.json());

// Initialize Stripe using the secret key from environment variables
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Serve static files from the Frontend folder
app.use(express.static(path.join(__dirname, '../Frontend')));

// Serve the homepage
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: path.join(__dirname, '../Frontend') });
});

// Create Checkout Session endpoint
app.post('/create-checkout-session', async (req, res) => {
    const { email, quantity } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            customer_email: email,
            line_items: [
                {
                    price_data: {
                        currency: 'EUR',
                        unit_amount: 0, // amount in cents for 10,00€ = 1000
                        product_data: {
                            name: 'Karawan - The Farm',
                        },
                    },
                    quantity: quantity,
                },
            ],
            success_url: `https://gpa-luxembourg.onrender.com/cart.html?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}`,
            cancel_url: `https://gpa-luxembourg.onrender.com/ticket.html`,
        });
        res.json({ url: session.url });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

// Endpoint to record ticket orders in the database
app.post('/record-ticket', async (req, res) => {
    const { email, quantity, stripeSessionId } = req.body;
    if (!email || !quantity || !stripeSessionId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Format the current date and time as YYYYMMDDHHmm
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const purchaseDatetime = year + month + day + hours + minutes;

    let records = [];
    for (let i = 0; i < quantity; i++) {
        const ticketId = 'TICKET-' + Math.random().toString(36).substr(2, 9).toUpperCase();
        records.push({ email, ticketId, purchaseDatetime, stripeSessionId, scanned: false });
    }

    try {
        const insertedTickets = await Ticket.insertMany(records);

        // Generate PDF tickets for each inserted ticket and send email
        let attachments = [];
        for (const ticket of insertedTickets) {
            try {
                const pdfBuffer = await generateTicketPDF(ticket);
                attachments.push({
                    filename: `ticket-${ticket.ticketId}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                });
            } catch (err) {
                console.error(`Failed to generate PDF for Ticket ID ${ticket.ticketId}:`, err);
            }
        }

        const mailOptions = {
            from: process.env.MAIL_FROM, // e.g., 'tickets@yourdomain.com'
            to: email,
            subject: 'Your Ticket(s) for the Event',
            text: `Thank you for your purchase!

            Please find your ticket(s) attached. Make sure you have them ready at the entrance.
            We look forward to seeing you!
            
            Mystery awaits ...`,
            attachments
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log('Email sent successfully to', email);
        } catch (err) {
            console.error('Failed to send email to', email, err);
        }

        res.json({ success: true, tickets: insertedTickets });
    } catch (error) {
        console.error('Error inserting tickets:', error);
        res.status(500).json({ error: 'Failed to record tickets' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});