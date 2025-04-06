const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors()); // To allow cross-origin requests

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error(err));
// User Schema and Model
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    surname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    age: {type:String, default:20},
    phone: {type:String, default:1234567890},
    gender: {type:String, default:"Female"},
    resetToken: String,
    tokenExpiry: Date,
    emergencyContacts: [
        {
            name: { type: String, required: true },
            phone: { type: String, required: true },
            relation: { type: String, required: true }
        }
    ],
    location: {
        latitude: Number,
        longitude: Number,
        updatedAt: Date,
      },
});

const User = mongoose.model('User', userSchema);

app.post('/signup', async (req, res) => {
    const { name, surname, email, password } = req.body;

    try {
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists!' });
        }

        // Hash password and save user
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, surname, email, password: hashedPassword });
        await newUser.save();

        res.status(201).json({ message: 'User created successfully!' });
    } catch (error) {
        console.error('Signup error:', error);  // Log the error
        res.status(500).json({ message: 'Internal Server Error' });
    }
});


// Login Route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found!' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials!' });

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secretkey', { expiresIn: '1h' });
        res.json({ message: 'Login successful!', token , name: user.name, email: user.email});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save User Data
app.post('/saveUserData', async (req, res) => {
    try {
        const { name, age, email, phone, gender,emergencyContacts , } = req.body;
        let user = await User.findOne({ email });

        if (user) {
            user.name = name;
            user.age = age;
            user.phone = phone;
            user.gender = gender;
            user.emergencyContacts = emergencyContacts;
        } else {
            user = new User({ name, age, email, phone, gender,emergencyContacts});
        }

        await user.save();
        res.status(200).json({ message: 'User data saved successfully!' });
    } catch (error) {
        res.status(500).json({ message: 'Error saving user data' });
    }
});


app.get('/getUserData/:email?', async (req, res) => {
    try {
        const email = req.params.email || req.query.email; // Fetch email from URL or query param

        if (!email) {
            return res.status(400).json({ message: "Email is required!" });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: "User not found!" });
        }

        res.status(200).json({
            name: user.name,
            age: user.age,
            email: user.email,
            phone: user.phone,
            gender: user.gender,
            emergencyContacts: user.emergencyContacts,
        });

    } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).json({ message: "Error fetching user data" });
    }
});

const twilio = require("twilio");

// 🔑 Twilio Credentials (Replace with your Twilio details)
const accountSid = process.env.SID;
const authToken = process.env.AUTH_TOKEN;
const twilioPhoneNumber = process.env.PHONE_NUMBER;

// Initialize Twilio Client
const client = new twilio(accountSid, authToken);

// 📩 Function to Send SMS via Twilio-------------------->uncomment this 14 lines  to send message
async function sendSMS(to, message) {
    try {
        const response = await client.messages.create({
            body: message,
            from: twilioPhoneNumber,
            to: to, // Recipient's phone number
        });

        console.log("✅ SMS Sent Successfully:", response.sid);
    } catch (error) {
        console.error("❌ Error Sending SMS:", error);
    }
}

// 🚨 SOS API Route
app.post("/sendSOS", async (req, res) => {
    try {
        const { email, mode, latitude, longitude, locationURL,customMessage } = req.body;
        const user = await User.findOne({ email });

        if (!user || !user.emergencyContacts.length) {
            return res.status(404).json({ message: "No emergency contacts found!" });
        }
         // Use custom message if provided, otherwise default
         const message = customMessage + `\n📍 Location: ${locationURL}`;
        // Prepare SOS Message
        //const message = `🚨 ${mode === "high" ? "HIGH ALERT!" : "SOS ALERT!"} 🚨\nCheck location: ${locationURL}`;

        // Send SMS to all emergency contacts
        for (const contact of user.emergencyContacts) {
            await sendSMS(contact.phone, message);
        }

        res.status(200).json({ success: true, message: "SOS alerts sent successfully!" });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Failed to send SOS alert." });
    }
});

app.post("/send-alert", async (req, res) => {
    try {
        const { email, signedUrl } = req.body;
        if (!email || !signedUrl) return res.status(400).json({ error: "Email and Signed URL are required" });

        // 1️⃣ Fetch User from MongoDB
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "User not found" });

        // 2️⃣ Fetch Emergency Contacts
        const contacts = user.emergencyContacts;
        if (!contacts.length) return res.status(404).json({ error: "No emergency contacts found" });

        // 3️⃣ Send SMS Alerts via Twilio
        for (let contact of contacts) {
            const messageBody = `${user.name} needs help!\nWatch this: ${signedUrl}`;
            const twilioClient = twilio(process.env.SID, process.env.AUTH_TOKEN);

            await twilioClient.messages.create({
                body: messageBody,
                from: process.env.PHONE_NUMBER, // Your Twilio number
                to: contact.phone // Contact's phone number
            });

            console.log(`✅ Alert sent to ${contact.name} (${contact.phone})`);
        }

        return res.json({ success: true, message: "Emergency alerts sent successfully!" });
    } catch (error) {
        console.error("❌ Error:", error.message);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});


//forgot password
// Email Transport
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  
  // 🔹 Forgot Password Route
  app.post("/api/forgot-password", async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ message: "Email not found!" });
  
    const token = uuidv4();
    const expiry = Date.now() + 10 * 60 * 1000; // 10 min
  
    user.resetToken = token;
    user.tokenExpiry = expiry;
    await user.save();
    const resetLink = `${process.env.CLIENT_URL}/forgotpassword/index.html?token=${token}`;
  
    // Send Email
    await transporter.sendMail({
      from: `NEUROSPARK <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Password Reset",
      html: `
        <p>You requested a password reset</p>
        <a href="${resetLink}">Click here to reset your password</a>
        <p>This link will expire in 10 minutes.</p>
      `
    });
  
    res.json({ message: "Reset password email sent! Check your inbox." });
  });
  
  // 🔹 Reset Password Route
  app.post("/api/reset-password", async (req, res) => {
    const { token, password } = req.body;
  
    const user = await User.findOne({
      resetToken: token,
      tokenExpiry: { $gt: Date.now() }
    });
  
    if (!user) {
      console.log("❌ Invalid or expired token");
      return res.status(400).json({ message: "Invalid or expired token!" });
    }
  
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.resetToken = null;
    user.tokenExpiry = null;
  
    await user.save();
  
    res.json({ message: "Password successfully updated!" });
  });
  //complete


  const userLocations = new Map(); // 💾 In-memory storage for live locations


// 📌 Route 1: /api/sent-alert — Sends live location link to emergency contacts
app.post("/api/sent-alert", async (req, res) => {
  try {
    const { email, liveLocationLink } = req.body;
    if (!email || !liveLocationLink) {
      return res.status(400).json({ error: "Email and liveLocationLink are required" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const contacts = user.emergencyContacts || [];
    if (!contacts.length) return res.status(404).json({ error: "No emergency contacts found" });

    const twilioClient = twilio(process.env.SID, process.env.AUTH_TOKEN);

    for (const contact of contacts) {
      await twilioClient.messages.create({
        body: `🚨 ${user.name} has triggered a High Alert!\nTrack live: ${liveLocationLink}`,
        from: process.env.PHONE_NUMBER,
        to: contact.phone
      });
    }

    res.json({ success: true, message: "Live location alerts sent successfully!" });
  } catch (err) {
    console.error("❌ /api/sent-alert Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 📌 Route 2: /api/update-location — Updates user’s current location
app.post("/api/update-location", (req, res) => {
  const { email, latitude, longitude } = req.body;
  if (!email || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: "Email, latitude, and longitude are required" });
  }

  userLocations.set(email, { latitude, longitude, updatedAt: new Date() });
  res.json({ success: true, message: "Location updated" });
});

  
// 📌 Route 3: /api/get-location — Returns latest location for live map
app.get("/api/get-location", (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: "Email is required" });
  
    const location = userLocations.get(email);
    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }
  
    res.json(location);
  });
  // DELETE emergency contact by index
  app.delete('/deleteEmergencyContact', async (req, res) => {
    const { email, contactId } = req.body;

    try {
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (
            typeof contactId !== 'number' ||
            contactId < 0 ||
            contactId >= user.emergencyContacts.length
        ) {
            return res.status(400).json({ message: 'Invalid contact index' });
        }

        user.emergencyContacts.splice(contactId, 1);
        await user.save();

        res.status(200).json({ message: 'Contact deleted successfully' });
    } catch (error) {
        console.error('Error deleting contact:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});