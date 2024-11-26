const express = require("express");
const app = express();
const port = 3030;
const cors = require("cors");
const bodyParser = require("body-parser");

const User = require("./models/user");
const Program = require("./models/program");

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const authorization_v2 = require("./middlewares/Authmiddleware");
const multer = require("multer");

app.use(cors());
// app.use(bodyParser.json()); Need to set limit for sending larger image from frontend to bacckend now
app.use(bodyParser.json({ limit: "10mb" }));

// Multer configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

mongoose
  .connect(
    "mongodb+srv://andytse:1234@cluster0.3213p.mongodb.net/information?retryWrites=true&w=majority&appName=Cluster0"
  )
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const { MongoClient, ServerApiVersion, Decimal128 } = require("mongodb");
const ObjectId = require("mongodb").ObjectId;

const uri =
  "mongodb+srv://andytse:1234@cluster0.3213p.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    db = client.db("information");
    await db.command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (err) {
    console.log(err);
  }
}
run();

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SERCET,
});

//Upload Payment Proof - to payment > payment_image (use payment_id)
app.post("/api/upload", upload.single("image"), async (req, res) => {
  try {
    // Check if file exists
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    // Get payment_id from the form data
    const payment_id = req.body.payment_id;
    if (!payment_id) {
      return res.status(400).json({ error: "Payment ID is required" });
    }

    // Convert buffer to base64
    const fileBuffer = req.file.buffer;
    const fileString = `data:${req.file.mimetype};base64,${fileBuffer.toString(
      "base64"
    )}`;

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(fileString, {
      folder: "payment_proofs",
      public_id: `payment_${payment_id}_${Date.now()}`,
    });

    // Update MongoDB with the image URL
    const result = await db.collection("payments").updateOne(
      { _id: new ObjectId(payment_id) },
      {
        $set: {
          payment_image: uploadResult.secure_url,
          updated_at: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Payment record not found" });
    }

    res.json({
      success: true,
      message: "Payment proof uploaded successfully",
      image_url: uploadResult.secure_url,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      error: "Error uploading payment proof",
      details: error.message,
    });
  }
});

// Receive image from frontend and then upload the image to the cloud
// Then return the URL while insert the URL to the database
app.post("/upload-image", authorization_v2, async (req, res) => {
  const merchantId = req.merchantId;
  const { image, prog_id } = req.body;
  let imageURL = "";
  console.log("The ID now is : ", merchantId);

  // use to check if the received data is a link or a file
  const isValidUrl = (string) => {
    const urlPattern_v1 = /^(https?:\/\/)([^\s$.?#].[^\s]*)$/i;
    const urlPattern_v2 = /^(http?:\/\/)([^\s$.?#].[^\s]*)$/i;
    return urlPattern_v1.test(string) || urlPattern_v2.test(string);
  };

  if (isValidUrl(image)) {
    imageURL = image;
  } else {
    // Upload the image file to server and get the image URL
    try {
      const uploadResult = await cloudinary.uploader.upload(image, {
        public_id: `${merchantId}_${Date.now()}`,
        folder: "program_image",
      });
      imageURL = uploadResult.url;
    } catch (err) {
      return res
        .status(501)
        .json({ message: "Server error", error: err.message });
    }
  }

  // console.log("Reach this endpoint2");

  // update the image URL to the database
  try {
    // db = client.db("testJoinCollections"); // as all data merge to the new database 'information'
    const result = await db
      .collection("programs")
      .updateOne(
        { _id: new ObjectId(prog_id) },
        { $push: { program_image: imageURL } }
      );

    if (result.modifiedCount === 0) {
      return res
        .status(404)
        .json({ message: "Merchant not found or no changes made." });
    }

    return res
      .status(200)
      .json({ message: "Image uploaded successfully!", imageURL });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Database server error", error: err.message });
  }
});

// What is the details include in this page?
// Use to get the merchant ID for fetching in other pages
// http://localhost:3030/dashboard
app.get("/dashboard", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  // console.log("token",token);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const merchantId = decoded.payload.merchant_id;
    res.status(200).json({ message: "Succeed to get the Merchant ID." });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "failed to get the Merchant ID" });
  }
});

// merchant creates participant
// endpoint: /frontend/app/(private)/dashboard/participant/page.js
async function checkVacancyTimeslot(targetSessionTimeslot, sessions_id_array) {
  // console.log("targetSessionTimeslot", targetSessionTimeslot);
  // console.log("sessions_id_array", sessions_id_array);
  try {
    //sessions_result === sessions of your merchant with same targetSessionDate
    // i.e., their vacancy_timeslot should be same
    const sessions_result = await db
      .collection("programs_sessions")
      .find({
        _id: { $in: sessions_id_array },
        session_dates: { $in: targetSessionTimeslot },
        session_type: "timeslot",
      })
      .project({
        _id: 1,
        session_dates: 1,
        session_type: 1,
        vacancy_timeslot: 1,
      })
      .toArray();
    // console.log("sessions_result", sessions_result);
    // to think: should i check vacancy_timeslot of all session ids are same here?

    const sessions_id_result = sessions_result.map((session) => session._id);
    // console.log("sessions_id_result", sessions_id_result);

    // payments_result === all payment records in timeslot === no. of participants in timeslot
    // 20241123 wilson
    const payments_result = await db
      .collection("payments")
      .find({
        session_id: { $in: sessions_id_result },
        payment_status: "Completed",
      })
      .toArray();
    // console.log("payments_result", payments_result);
    // numberOfparticipant === current enrolled participants (before new participant)
    const currentNoOfParticipants = payments_result.length;

    const session_vacancy_timeslot = sessions_result[0].vacancy_timeslot;

    const newParticipant = 1;

    // session_vacancy_timeslot is still available after add new participant

    const availableVacancy = session_vacancy_timeslot - currentNoOfParticipants;

    if (currentNoOfParticipants + newParticipant <= session_vacancy_timeslot) {
      console.log("---------------------------------");
      console.log("vacancy_timeslot is available");
      console.log(
        `vacancy_timeslot of ${targetSessionTimeslot}: ${session_vacancy_timeslot};`
      );
      console.log(
        `enrolled participants (before new participant): ${currentNoOfParticipants};`
      );
      console.log(`available vacancy: ${availableVacancy}`);
      return true;
    } else {
      console.log("---------------------------------");
      console.log("vacancy_timeslot is unavailable");
      console.log(
        `vacancy_timeslot of ${targetSessionTimeslot}: ${session_vacancy_timeslot};`
      );
      console.log(
        `current enrolled participants (before new participant): ${currentNoOfParticipants};`
      );
      console.log(`available vacancy: ${availableVacancy}`);
      return false;
    }
  } catch (err) {
    console.log(err);
    return "error";
  }
}

// merchant creates participant
// endpoint: /frontend/app/(private)/dashboard/participant/page.js
async function checkVacancyParticipant(
  targetSessionVacancyParticipant,
  targetSessionId
) {
  try {
    // 20241123 wilson
    const payments_result = await db
      .collection("payments")
      .find({ session_id: targetSessionId, payment_status: "Completed" })
      .toArray();
    // console.log("payments_result", payments_result);
    // numberOfparticipant === current enrolled participants (before new participant)
    const currentNoOfParticipants = payments_result.length;
    const newParticipant = 1;
    const availableVacancy =
      targetSessionVacancyParticipant - currentNoOfParticipants;
    if (
      currentNoOfParticipants + newParticipant <=
      targetSessionVacancyParticipant
    ) {
      console.log("---------------------------------");
      console.log("vacancy_participant is available");
      console.log(
        `vacancy_participant of ${targetSessionId}: ${targetSessionVacancyParticipant}`
      );
      console.log(
        `enrolled participants (before new participant): ${currentNoOfParticipants};`
      );
      console.log(`available vacancy: ${availableVacancy}`);
      return true;
    } else {
      console.log("---------------------------------");
      console.log("vacancy_participant is unavailable");
      console.log(
        `vacancy_participant of ${targetSessionId}: ${targetSessionVacancyParticipant}`
      );
      console.log(
        `enrolled participants (before new participant): ${currentNoOfParticipants};`
      );
      console.log(`available vacancy: ${availableVacancy}`);
      return false;
    }
  } catch (err) {
    console.log(err);
  }
}

// participant enroll program session/ merchant creates participant / merchant add session for participant
// endpoint: /frontend/app/(private)/dashboard/participant/page.js
async function checkSession(enrolledSessionId, sessions_id_array) {
  // check session type first
  const sessionInfo_result = await db
    .collection("programs_sessions")
    .find({ _id: enrolledSessionId })
    .project({
      _id: 1,
      session_dates: 1,
      session_type: 1,
      vacancy_participant: 1,
    })
    .toArray();

  if (sessionInfo_result.length === 0) {
    return { id: enrolledSessionId, status: "invalid" };
  }

  const targetSessionId = sessionInfo_result[0]._id;
  const targetSessionTimeslot = sessionInfo_result[0].session_dates;
  const targetSessionVacancyParticipant =
    sessionInfo_result[0].vacancy_participant;
  const targetSessionType = sessionInfo_result[0].session_type;
  const response_BackEnd = {};
  if (targetSessionType === "timeslot") {
    if (targetSessionTimeslot.length === 1) {
      // console.log("timeslot type and date length are correct");

      const check_timeslot = await checkVacancyTimeslot(
        targetSessionTimeslot,
        sessions_id_array
      );
      response_BackEnd.check_timeslot = check_timeslot;
      if (!check_timeslot) {
        console.log("response_BackEnd", response_BackEnd);
        return { id: targetSessionId, status: "full" };
      }
      // check_timeslot: true == timeslot available || false == timeslot unavailable
      const check_participant = await checkVacancyParticipant(
        targetSessionVacancyParticipant,
        targetSessionId
      );
      response_BackEnd.check_participant = check_participant;
      if (!check_participant) {
        console.log("response_BackEnd", response_BackEnd);
        return { id: targetSessionId, status: "full" };
      }
      console.log("response_BackEnd", response_BackEnd);
      return { id: targetSessionId, status: "valid" };
    } else {
      console.log(
        `current date length is ${targetSessionTimeslot.length}and it should be 1 only, please check`
      );
    }
  }

  if (targetSessionType === "participant") {
    console.log("hi participant is detected");
    const check_participant = await checkVacancyParticipant(
      targetSessionVacancyParticipant,
      targetSessionId
    );
    response_BackEnd.check_participant = check_participant;
    if (!check_participant) {
      console.log("response_BackEnd", response_BackEnd);
      return { id: targetSessionId, status: "full" };
    }
    console.log("response_BackEnd", response_BackEnd);
    return { id: targetSessionId, status: "valid" };
  }
}

// merchant creates participant
// endpoint: /frontend/app/(private)/dashboard/participant/page.js
async function getPaymentAmount(sessionId, participantId) {
  try {
    const sessions_of_merchant_array = await db
      .collection("programs_sessions")
      .find({
        _id: sessionId,
      })
      .project({ _id: 1, program_id: 1, session_dates: 1 })
      .toArray();

    const programId = sessions_of_merchant_array[0].program_id;

    const lessonQty = sessions_of_merchant_array[0].session_dates.length;

    const programInfo = await db
      .collection("programs")
      .find({ _id: programId })
      .project({ _id: 0, program_price_per_lesson: 1 })
      .toArray();

    const programPriceFloat = parseFloat(
      programInfo[0].program_price_per_lesson.toString()
    );
    const programPriceInt = Math.floor(programPriceFloat);
    const amount = lessonQty * programPriceInt;

    const insertPayment = await db.collection("payments").insertOne({
      amount,
      payment_status: "Pending",
      // payment_date: new Date(), should be added when payment status changed to paid
      payment_method: "Created by merchant",
      createdAt: new Date(),
      participant_id: participantId,
      session_id: sessions_of_merchant_array[0]._id,
    });
    console.log("merchant side insert payment", insertPayment);
    return insertPayment.insertedId; // 20241119updated by Wilson
  } catch (err) {
    console.log(err);
  }
}

// Created By Tim
// merchant creates program
// endpoint: /frontend/app/(private)/dashboard/program/page.js
app.post("/add-new-program", authorization_v2, async (req, res) => {
  const { merchantId } = req;
  const {
    progName,
    progType,
    imageLink,
    description,
    progNotice,
    progPrice,
    duration,
  } = req.body;

  // console.log(req.body);

  const newProgram = new Program({
    program_name_zh: progName,
    program_type: progType,
    program_image: imageLink,
    description: description,
    program_notice: progNotice,
    merchant_id: new ObjectId(merchantId),
    program_price_per_lesson: progPrice,
    lesson_duration: duration,
  });

  try {
    // Save the program to the database
    const result = await newProgram.save();
    console.log("succeed to register new program!");
    return res
      .status(201)
      .json({ message: "Successful to create Program!", program: result });
  } catch (err) {
    console.error(err);
    return res.status(201).json({ message: "Fail to create Program!" });
  }

  // return res.status(201).json({ message: "Test to create Program!" });
});

// merchant creates participant
// endpoint: /frontend/app/(private)/dashboard/participant/page.js
app.post("/add-new-participant-non-merchant", async (req, res) => {
  const {
    participant_name,
    telephone_no,
    enrolled_session_id, //enrolled_session_id data type: array
    merchantId,
  } = req.body;

  // console.log("participant_name", participant_name);
  // console.log("telephone_no", telephone_no);
  console.log("enrolled_session_id", enrolled_session_id);

  const enrolled_session_id_ObjectIdarray = enrolled_session_id.map((id) => {
    return new ObjectId(id);
  });

  try {
    // check whether the session id belongs to merchant first
    // get sessionsIdArray which belongs to your merchantId
    const programs_of_merchant_array = await db
      .collection("programs")
      .find({ merchant_id: new ObjectId(merchantId) })
      .project({ _id: 1, merchant_id: 1 })
      .toArray();
    // console.log("programs_of_merchant_array", programs_of_merchant_array);
    const programs_id_of_merchant_array = programs_of_merchant_array.map(
      (program) => program._id
    );
    const sessions_of_merchant_array = await db
      .collection("programs_sessions")
      .find({
        program_id: { $in: programs_id_of_merchant_array },
      })
      .project({ _id: 1, program_id: 1 })
      .toArray();
    // console.log("sessions_of_merchant_array", sessions_of_merchant_array);
    const sessions_id_array = sessions_of_merchant_array.map(
      (session) => session._id
    );
    // console.log("sessions_id_array", sessions_id_array);

    // check if inputted session id included in merchant's session ids
    // equals is ObjectId method
    const checks = enrolled_session_id_ObjectIdarray.map(async (id) => {
      const isValidSession = sessions_id_array.some((sessionId) =>
        sessionId.equals(id)
      );
      if (!isValidSession) {
        return { id, status: "invalid" };
      }
      return await checkSession(id, sessions_id_array);
    });

    const results = await Promise.all(checks);
    // console.log("results", results);
    const invalidResults = results.filter(
      (result) => result.status !== "valid"
    );
    // console.log("invalidResults", invalidResults);

    if (invalidResults.length > 0) {
      const messages = invalidResults.map((result) => {
        const idString = result.id.toString();
        return result.status === "invalid"
          ? `Session ID ${idString} is invalid`
          : `Session ID ${idString} is full`;
      });

      return res.status(400).json({
        message: messages.join(", "),
        invalidResults: invalidResults.map((result) => ({
          id: result.id.toString(),
          status: result.status,
        })),
      });
    }

    if (invalidResults.length === 0 && results[0].status === "valid") {
      const insertParticipant = await db.collection("participants").insertOne({
        participant_name,
        telephone_no,
        enrolled_session_id: enrolled_session_id_ObjectIdarray,
        createdAt: new Date(),
      });
      console.log("merchant side insert participant", insertParticipant);
      const payments = enrolled_session_id_ObjectIdarray.map(
        async (sessionId) => {
          return await getPaymentAmount(
            sessionId,
            insertParticipant.insertedId
          );
        }
      );
      const addPayments = await Promise.all(payments);

      return res.status(200).json({
        message:
          "succeed to add new participant, collections: participants and payments are updated.",
        paymentId: addPayments[0],
      }); // 20241119updated by Wilson
    }
  } catch {
    return res.status(400).json({ message: "failed to upload" }); // 20241119updated by Wilson
  }
});

// merchant creates participant
// endpoint: /frontend/app/(private)/dashboard/participant/page.js
app.post("/add-new-participant", authorization_v2, async (req, res) => {
  const { merchantId } = req;
  const {
    participant_name,
    telephone_no,
    enrolled_session_id, //enrolled_session_id data type: array
  } = req.body;

  // console.log("participant_name", participant_name);
  // console.log("telephone_no", telephone_no);
  // console.log("enrolled_session_id", enrolled_session_id);

  const enrolled_session_id_ObjectIdarray = enrolled_session_id.map((id) => {
    return new ObjectId(id);
  });

  try {
    // check whether the session id belongs to merchant first
    // get sessionsIdArray which belongs to your merchantId
    const programs_of_merchant_array = await db
      .collection("programs")
      .find({ merchant_id: new ObjectId(merchantId) })
      .project({ _id: 1, merchant_id: 1 })
      .toArray();
    // console.log("programs_of_merchant_array", programs_of_merchant_array);
    const programs_id_of_merchant_array = programs_of_merchant_array.map(
      (program) => program._id
    );
    const sessions_of_merchant_array = await db
      .collection("programs_sessions")
      .find({
        program_id: { $in: programs_id_of_merchant_array },
      })
      .project({ _id: 1, program_id: 1 })
      .toArray();
    // console.log("sessions_of_merchant_array", sessions_of_merchant_array);
    const sessions_id_array = sessions_of_merchant_array.map(
      (session) => session._id
    );
    // console.log("sessions_id_array", sessions_id_array);

    // check if inputted session id included in merchant's session ids
    // equals is ObjectId method
    const checks = enrolled_session_id_ObjectIdarray.map(async (id) => {
      const isValidSession = sessions_id_array.some((sessionId) =>
        sessionId.equals(id)
      );
      if (!isValidSession) {
        return { id, status: "invalid" };
      }
      return await checkSession(id, sessions_id_array);
    });

    const results = await Promise.all(checks);
    console.log("results", results);
    const invalidResults = results.filter(
      (result) => result.status !== "valid"
    );
    console.log("invalidResults", invalidResults);

    if (invalidResults.length > 0) {
      const messages = invalidResults.map((result) => {
        const idString = result.id.toString();
        return result.status === "invalid"
          ? `Session ID ${idString} is invalid`
          : `Session ID ${idString} is full`;
      });

      return res.status(400).json({
        message: messages.join(", "),
        invalidResults: invalidResults.map((result) => ({
          id: result.id.toString(),
          status: result.status,
        })),
      });
    }

    if (invalidResults.length === 0 && results[0].status === "valid") {
      const insertParticipant = await db.collection("participants").insertOne({
        participant_name,
        telephone_no,
        enrolled_session_id: enrolled_session_id_ObjectIdarray,
        createdAt: new Date(),
      });
      console.log("merchant side insert participant", insertParticipant);
      const payments = enrolled_session_id_ObjectIdarray.map(
        async (sessionId) => {
          return await getPaymentAmount(
            sessionId,
            insertParticipant.insertedId
          );
        }
      );
      const addPayments = await Promise.all(payments);

      return res.json(
        "succeed to add new participant, collections: participants and payments are updated"
      ); //20241125 update
    }
  } catch {
    // to-do: check any fields missing?
    res.json("failed to add new participant");
  }
});

// use merchant id to fetch programs
// http://localhost:3030/programs/:merchantId
// (example) http://localhost:3030/programs/672b7780fa8bcf1cc05e8d01
// frontend endpoint: /frontend/app/(public)/[merchant_id]/page.js
app.get("/programs/:merchantId", async (req, res) => {
  const { merchantId } = req.params;
  try {
    const programs = await db
      .collection("programs")
      .find({ merchant_id: new ObjectId(merchantId) })
      .toArray();
    res.json(programs);
  } catch (err) {
    console.log("/programs/:merchantId", err);
    res.json(err);
  }
});

// Check the password before updating the password
app.post("/verify-password", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "username and password are required." });
  }

  try {
    const user = await User.findOne({ merchant_username: username });
    const match = await bcrypt.compare(password, user.password);

    if (match) {
      return res.status(200).json({ message: "Verified." });
    } else {
      return res.status(406).json({ message: "Unverified" });
    }
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized." });
  }
});

// Update the password
app.post("/update-password", async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const result = await User.updateOne(
      { merchant_username: username },
      { $set: { password: hashedPassword } }
    );
    console.log("Update result:", result);
    if (result.acknowledged === true) {
      return res.status(200).json({ message: "Successful to update" });
    } else {
      return res.status(400).json({ message: "Fail to update" });
    }
  } catch (error) {
    return res.status(400).json({ message: "Cannot update" });
  }
});

// update phone number
app.post("/update-phone-number", async (req, res) => {
  const { username, phoneNumber } = req.body;
  try {
    const existingUser = await User.findOne({ telephone_no: phoneNumber });
    if (existingUser) {
      return res.status(406).json({ message: "Duplicated Phone Number" });
    }
  } catch (error) {
    return res.status(400).json({ message: "Database Error 1" });
  }

  console.log("Point Reach here");

  try {
    console.log(username, phoneNumber);

    const result = await User.updateOne(
      { merchant_username: username },
      { $set: { telephone_no: phoneNumber } }
    );
    console.log("the result is", result);
    console.log("Point Reach here 2");
    return res.status(200).json({ message: "Phone number is updated" });
  } catch (error) {
    console.log("Point Reach here 3");
    return res.status(400).json({ message: "Database Error 2" });
  }
});

// update email
app.post("/update-email", async (req, res) => {
  const { username, email } = req.body;
  try {
    const existingUser = await User.findOne({ merchant_email: email });
    if (existingUser) {
      return res.status(406).json({ message: "Duplicated Email Address" });
    }
  } catch (error) {
    return res.status(400).json({ message: "Database Error 1" });
  }

  console.log("Point Reach here");

  try {
    const result = await User.updateOne(
      { merchant_username: username },
      { $set: { merchant_email: email } }
    );
    return res.status(200).json({ message: "Email Address is updated" });
  } catch (error) {
    return res.status(400).json({ message: "Database Error 2" });
  }
});

app.get("/profile", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  // console.log("Backend Token:", token);

  if (!token) {
    return res.status(403).json({ message: "No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const merchant_username = decoded.payload.merchant_username;
    // console.log(decoded);
    // console.log(merchant_username);

    if (!merchant_username || typeof merchant_username !== "string") {
      return res.status(400).json({ message: "Invalid username." });
    }

    // Fetch user data from the database
    const user = await User.findOne({ merchant_username });
    // console.log("Profile endpoint hit");

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Return user profile data
    res.json({
      id: user._id,
      merchant_username: user.merchant_username,
      merchant_email: user.merchant_email,
      organization: user.organization,
      telephone_no: user.telephone_no,
      payment_number: user.payment_number,
    });
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({ message: "Unauthorized." });
  }
});

// new merchant registration
app.post("/register", async (req, res) => {
  const {
    merchant_username,
    merchant_email,
    telephone_no,
    organization,
    password,
  } = req.body;

  const errors = [];

  // Check if the merchant_username is already in used. If yes, return to the frontend and page
  try {
    const existingUser = await User.findOne({ merchant_username });
    if (existingUser) {
      // return res.status(409).json({ error: "此用戶名已使用，請使用另一名稱" });
      errors.push("Duplicated username. Please choose a different username");
    }
  } catch (err) {
    console.error("Error while checking username:", err);
  }

  // Check if the email address is already in used. If yes, return to the frontend and page
  const existingEmail = await User.findOne({ merchant_email });
  if (existingEmail) {
    // return res.status(409).json({ error: "Email is already in use" });
    errors.push("Duplicated email. Please provide a different email address");
  }

  if (errors.length > 0) {
    return res.status(409).json({ errors });
  }

  const newUser = new User({
    merchant_username,
    merchant_email,
    telephone_no,
    organization,
    password,
  });

  try {
    // Save the user to the database
    await newUser.save();
    console.log("succeed to register new merchant!");
    // console.log("The hashed password is: ", hashedPassword);
    return res.status(201).json({ message: "User registered successfully!" });
  } catch (err) {
    console.error(err);
    // If there's a validation error or duplicate email, send an appropriate response
    // res
    //   .status(400)
    //   .json({ message: "User registration failed.", error: err.message });
    console.log("fail to register new merchant!");
  }
});

// login
app.post("/login", async (req, res) => {
  const { merchant_username, password } = req.body;

  try {
    // Find the user by username
    const user = await User.findOne({ merchant_username });

    // Check if the user exists
    if (!user) {
      return res.status(401).json({ message: "帳號不存在" });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ message: "密碼錯誤" });
    }
    // If login is successful, send a success response
    else {
      const payload = {
        merchant_id: user.id,
        merchant_username: user.merchant_username,
        // merchant_email: user.merchant_email,
      };
      const token = jwt.sign({ payload }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });
      return res
        .status(200)
        .json({ status: true, message: "Login successful!", token: token });
    }
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "An error occurred.", error: err.message });
  }
});

// check and delete
// app.get("/get-programs/:merchantId", async (req, res) => {
//   const { merchantId } = req.params;
//   try {
//     const programs_result = await db
//       .collection("programs")
//       .find({
//         merchant_id: new ObjectId(merchantId),
//       })
//       .project({ _id: 1 })
//       .toArray();
//     const programIdArray = programs_result.map(({ _id }) => {
//       return _id;
//     });
//     res.json(programIdArray);
//   } catch (err) {
//     console.log(err);
//     res.send(err);
//   }
// });

// frances 672b7780fa8bcf1cc05e8d01
// andy 672ad61e2455c91d8e65852e
// http://localhost:3030/get-programs-type/672b7780fa8bcf1cc05e8d01
// http://localhost:3030/get-programs-type/672ad61e2455c91d8e65852e

// receive = user selected type / sub types in front end
// use the received input to check = use program-session-programId ge type, subtype match with program collection
// endpoint: /frontend/app/(public)/[merchant_id]/[program_id]/page.js
app.get("/programs-sessions/:programId", async (req, res) => {
  const { programId } = req.params;
  try {
    const result = await db
      .collection("programs_sessions")
      .find({ program_id: new ObjectId(programId) })
      .toArray();
    console.log("succeed to get program-session");

    // 20241122 updated by Wilson starts
    if (result.length === 0) {
      // return res.send(`Program Id ${programId} is not found in program`);
      return res.json({
        message: `Program Id ${programId} is not found in program`,
      });
    }

    const filterInactiveSession = result.filter(
      (res) => !res.active === false || res.active === undefined
    );
    // console.log("filterInactiveSession", filterInactiveSession);
    // res.json(result);
    res.json(filterInactiveSession);
    // 20241122 updated by Wilson ends
  } catch (err) {
    console.log(err);
    // res.send("failed to get program-session");
    res.json({ message: "failed to get program-session" });
  }
});

// Merchant Manage User
// endpoint: /frontend/app/(private)/dashboard/participant/[id]/page.js
app.post("/all-participants", authorization_v2, async (req, res) => {
  const { merchantId } = req;

  try {
    // Query 1: program id array of merchant
    const programs_result = await db
      .collection("programs")
      .find({
        merchant_id: new ObjectId(merchantId),
      })
      .project({ _id: 1 })
      .toArray();

    // console.log("programs_result", programs_result);
    const programIdArray = programs_result.map((program) => program._id);
    // console.log("programIdArray", programIdArray);
    // Query 2: program session id array of merchant
    const programs_sessions_result = await db
      .collection("programs_sessions")
      .find({ program_id: { $in: programIdArray } })
      .project({ _id: 1 })
      .toArray();

    const programsSessionsIdArray = programs_sessions_result.map(
      (session) => session._id
    );
    // console.log("programsSessionsIdArray", programsSessionsIdArray);
    // Query 3: Participant Data of merchant
    const participants_result = await db
      .collection("participants")
      .find({
        enrolled_session_id: { $in: programsSessionsIdArray },
      })
      .project({
        _id: 1,
        participant_name: 1,
        telephone_no: 1,
        enrolled_session_id: {
          $filter: {
            input: "$enrolled_session_id", // 過濾來源陣列
            as: "sessionId", // 循環變數名稱
            cond: { $in: ["$$sessionId", programsSessionsIdArray] }, // 只保留匹配的 ID
          },
        },
        merchants_remarks: {
          $let: {
            vars: {
              remarksArray: {
                $objectToArray: "$merchants_remarks", // 將 merchants_remarks 轉換為陣列
              },
            },
            in: {
              $arrayElemAt: [
                {
                  $map: {
                    input: "$$remarksArray", // 使用 remarksArray
                    as: "item",
                    in: {
                      $cond: {
                        if: { $eq: ["$$item.k", merchantId] }, // 匹配 merchantId
                        then: "$$item.v", // 返回匹配的备注
                        else: "", // 不匹配时返回 ""
                      },
                    },
                  },
                },
                0, // 获取数组中的第一个元素
              ],
            },
          },
        },
      })
      .toArray();
    // console.log("participants_result", participants_result);
    res.json(participants_result);
  } catch (err) {
    console.log(err);
    // res.send("failed");
    res.json({ message: "failed to fetch participan" });
  }
});

//endpoint: /frontend/app/(private)/dashboard/participant/[id]/page.js
app.post("/get-programId-by-sessionId", async (req, res) => {
  try {
    const sessionIdArray = req.body;

    const storedArr_sessionIdArray = sessionIdArray.slice().map((sessionId) => {
      return new ObjectId(sessionId);
    });
    const result = await db
      .collection("programs_sessions")
      .find({ _id: { $in: storedArr_sessionIdArray } })
      .project({ _id: 1, program_id: 1, session_dates: 1 })
      .toArray();

    const programDataPackage = await Promise.all(
      result.map(async ({ _id, program_id, session_dates }) => {
        const programInfo = await db
          .collection("programs")
          .findOne({ _id: program_id }, { projection: { program_name_zh: 1 } });
        return {
          sessionInfo: { _id, session_dates },
          programInfo,
        };
      })
    );

    console.log("succeed to get-programId-by-sessionId");
    res.json(programDataPackage);
  } catch (err) {
    console.log(err);
    // res.send("failed to get-programId-by-sessionId");
    res.json({ message: "failed to get-programId-by-sessionId" });
  }
});

// Merchant Manage Program
// use merchant id to fetch programs
// http://localhost:3030/all-programs/:merchantId
// (example) http://localhost:3030/all-programs/672b7780fa8bcf1cc05e8d01
// => update : Change from GET to POST =>
app.post("/all-programs", authorization_v2, async (req, res) => {
  // console.log("Endpoint reach here");
  // console.log(req.body);
  // const { merchantIdToken } = req.body;

  // if (!merchantIdToken) {
  //   return res.status(403).json({ message: "No token provided." });
  // }

  // console.log("The token in backend is: ", merchantIdToken);
  // // decode
  // const merchantId = authorization(merchantIdToken);
  // console.log("The merchantId in backend is", merchantId);
  // const token = req.headers.authorization?.split(" ")[1];
  const { merchantId } = req;

  const programs = await db
    .collection("programs")
    .find({ merchant_id: new ObjectId(merchantId) })
    .project({
      _id: 1,
      program_name_zh: 1,
      program_type: 1,
      program_price_per_lesson: 1,
    })
    .toArray();

  res.json(programs);
});

// endpoint: frontend endpoint: /frontend/app/(public)/[merchant_id]/page.js
// endpoint: /frontend/app/(private)/dashboard/program/[id]/page.js
app.get("/get-program-info/:programId", async (req, res) => {
  try {
    // to do list: check merchant Id === data base to prevent merchant read other merchants' program
    const { programId } = req.params;
    const program = await db
      .collection("programs")
      .find({ _id: new ObjectId(programId) })
      .toArray();

    if (program.length > 0) {
      // convert to number from decimal128
      if (program[0].program_price_per_lesson instanceof Decimal128) {
        program[0].program_price_per_lesson = parseFloat(
          program[0].program_price_per_lesson.toString()
        );
      }

      // for edit program use in http://localhost:3000/dashboard/program/[programId]
      program[0].isEditing = false;
      res.json(program[0]);
    }
  } catch (err) {
    console.log(err);
  }
});

// endpoint: /frontend/app/(private)/dashboard/program/[id]/page.js
async function getPaymentNumber(sessionId) {
  try {
    const payments_result = await db
      .collection("payments")
      .find({ session_id: sessionId, payment_status: "Completed" })
      .project({ _id: 1 })
      .toArray();
    const payments_Id_array = payments_result.map((payment) => payment._id);
    // console.log("payments_Id_array", payments_Id_array);
    return payments_Id_array.length;
  } catch (err) {
    console.log(err);
  }
}

// endpoint: /frontend/app/(private)/dashboard/program/[id]/page.js
app.get("/get-session-info/:programId", async (req, res) => {
  const { programId } = req.params;
  // console.log("programId", programId);
  let sessions;
  try {
    sessions = await db
      .collection("programs_sessions")
      .find({ program_id: new ObjectId(programId) })
      .project({})
      .toArray();
  } catch (err) {
    console.log("failed to fetch sessions by program id", err);
  }
  try {
    const sessionsWithPaymentInfo = sessions.map(async (session) => {
      return {
        ...session,
        isEditing: false,
        showButton: true,
        numberOfParticipant: await getPaymentNumber(session._id),
        availableSeats:
          session.vacancy_participant - (await getPaymentNumber(session._id)),
      };
    });
    const result = await Promise.all(sessionsWithPaymentInfo);
    const filterInactiveSession = result.filter(
      (res) => !res.active === false || res.active === undefined
    ); // 20241122 updated by Wilson
    // console.log("filterInactiveSession", filterInactiveSession); // 20241122 updated by Wilson
    // res.json(result);
    res.json(filterInactiveSession); // 20241122 updated by Wilson
  } catch (err) {
    // res.send("failed to get fetch payment info with session id");
    res.json({ message: "failed to get fetch payment info with session id" });
  }
});

// endpoint: /frontend/app/(private)/dashboard/program/[id]/page.js
app.post("/update-program-info", async (req, res) => {
  const { programInfo } = req.body;
  const {
    _id,
    program_name_zh,
    program_type,
    program_subtype,
    description,
    program_notice,
    program_price_per_lesson,
    lesson_duration,
    program_image,
  } = programInfo;

  const priceDecimal = Decimal128.fromString(String(program_price_per_lesson));

  try {
    const updateResult = await db.collection("programs").updateOne(
      {
        _id: new ObjectId(_id),
      },
      {
        $set: {
          program_name_zh,
          program_type,
          program_subtype,
          description,
          program_notice,
          program_price_per_lesson: priceDecimal,
          lesson_duration,
          program_image,
        },
      }
    );
    console.log("updated program info", updateResult);
    // res.send("succeeded to update");
    res.json({ message: "succeeded to update" });
  } catch (err) {
    console.log(err);
    // res.send("failed to update");
    res.json({ message: "failed to update" });
  }
});

// 20241122 updated by Wilson
// endpoint: /frontend/app/(private)/dashboard/program/[id]/page.js
app.post("/update-session-info", async (req, res) => {
  const { sessionsInfo } = req.body;

  const sessionsInfo_converted = sessionsInfo.map((session) => {
    // 直接處理 session.session_dates 數組
    const session_dates_converted = session.session_dates.map((dateStr) => {
      const date = new Date(dateStr);
      console.log("date", date);
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid date format: ${dateStr}`);
      }
      return date;
      // 將本地時間（UTC+8）轉換為 UTC-8
      // const utcMinus8Date = new Date(date.getTime() - 8 * 60 * 60 * 1000); // 減去8小時
      // return utcMinus8Date;
    });

    return {
      ...session,
      session_dates: session_dates_converted,
    };
  });

  try {
    const bulkOperations = sessionsInfo_converted.map((session) => ({
      updateOne: {
        filter: { _id: new ObjectId(session._id) },
        update: {
          $set: {
            session_dates: session.session_dates,
            vacancy_participant: session.vacancy_participant || 0,
            vacancy_timeslot: session.vacancy_timeslot || 0,
            session_notice: session.session_notice,
            teacher: session.teacher,
            session_type: session.session_type,
          },
        },
      },
    }));

    const result = await db
      .collection("programs_sessions")
      .bulkWrite(bulkOperations);

    return res.status(200).json({
      message: "Sessions updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error updating sessions:", error);
    return res.status(400).json({ message: "Failed to update sessions" });
  }
});

// endping: frontend\app/(private)/dashboard/program/[id]/page.js
app.post("/create-session-info", async (req, res) => {
  const {
    program_id,
    session_type,
    teacher,
    session_dates,
    vacancy_timeslot,
    vacancy_participant,
    session_notice,
  } = req.body;
  try {
    const createSession = await db.collection("programs_sessions").insertOne({
      program_id: new ObjectId(program_id),
      session_type,
      teacher,
      session_dates,
      vacancy_timeslot,
      vacancy_participant,
      session_notice,
      createdAt: new Date(),
    });
    // console.log("createSession", createSession);
    // res.send("Create session successfully");
    res.json({ message: "Create session successfully" });
  } catch (err) {
    console.log(err);
    // res.send("Create session failed");
    res.json({ message: "Create session failed" });
  }
});

// endpoint: frontend\app/(private)/dashboard/program/[id]/page.js
app.delete("/delete-turn-session-to-inactive", async (req, res) => {
  const { _id } = req.body;
  console.log("_id", _id);
  try {
    const result = await db
      .collection("programs_sessions")
      .updateOne({ _id: new ObjectId(_id) }, { $set: { active: false } });

    if (result.modifiedCount === 0) {
      console.log("Session not found or already inactive");

      return res.status(404).json({
        message: "Session not found or already inactive",
      });
    }

    console.log("Session successfully marked as inactive");
    return res.status(200).json({
      message: "Session successfully marked as inactive",
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("Delete session error:", err);
    return res.status(500).json({
      message: "Failed to update session status",
    });
  }
});

// endpoint: /frontend/app/(private)/dashboard/participant/[id]/page.js
app.post("/update-participant-info", authorization_v2, async (req, res) => {
  // const { participant } = req.body;
  const { _id, participant_name, telephone_no, merchants_remarks } = req.body;

  const { merchantId } = req;

  console.log(_id);
  console.log("merchants_remarks", merchants_remarks);
  try {
    const updateResult = await db.collection("participants").updateOne(
      {
        _id: new ObjectId(_id),
      },
      {
        $set: {
          participant_name,
          telephone_no,
          [`merchants_remarks.${merchantId}`]: merchants_remarks,
        },
      }
    );
    if (updateResult.modifiedCount > 0) {
      res.json({ success: true, message: "Participant updated successfully" });
    } else {
      res.json({
        success: false,
        message: "No changes made or participant not found",
      });
    }
  } catch (err) {
    console.log(err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update participant" });
  }
});

// endpoint: /frontend/app/(private)/dashboard/participant/[id]/page.js
app.post(
  "/update-participant-info-session",
  authorization_v2,
  async (req, res) => {
    const { participantId, sessionIds } = req.body;
    const { merchantId } = req;
    console.log("participantId", participantId);
    console.log("merchantId", merchantId);
    console.log("sessionIds", sessionIds);

    // Convert to ObjectId array
    const enrolled_session_id_ObjectIdArray = sessionIds.map(
      (id) => new ObjectId(id)
    );

    try {
      // Validate sessions
      const checks = enrolled_session_id_ObjectIdArray.map(async (id) => {
        const sessions_id_array = await getSessionByMerchant(merchantId);
        const isValidSession = sessions_id_array.some((sessionId) =>
          sessionId.equals(id)
        );
        if (!isValidSession) {
          return { id, status: "invalid" };
        }
        return await checkSession(id, sessions_id_array);
      });

      const results = await Promise.all(checks);
      console.log("results", results);
      const invalidResults = results.filter(
        (result) => result.status !== "valid"
      );
      console.log("invalidResults", invalidResults);

      if (invalidResults.length > 0) {
        const messages = invalidResults.map((result) => {
          const idString = result.id.toString();
          return result.status === "invalid"
            ? `Session ID ${idString} is invalid`
            : `Session ID ${idString} is full`;
        });

        return res.status(400).json({
          message: messages.join(", "),
          invalidResults: invalidResults.map((result) => ({
            id: result.id.toString(),
            status: result.status,
          })),
        });
      }

      if (invalidResults.length === 0 && results[0].status === "valid") {
        const updateResult = await db.collection("participants").updateOne(
          { _id: new ObjectId(participantId) },
          {
            $addToSet: {
              enrolled_session_id: {
                $each: enrolled_session_id_ObjectIdArray,
              },
            },
          }
        );
        console.log(
          "merchant side added session for participant",
          updateResult
        );
        if (updateResult.modifiedCount === 0) {
          return res.status(400).json({
            message:
              "One of the session id was enrolled previously, please check",
            modifiedCount: updateResult.modifiedCount,
          });
        }

        const payments = enrolled_session_id_ObjectIdArray.map(
          async (sessionId) => {
            return await getPaymentAmount(
              sessionId,
              new ObjectId(participantId)
            );
          }
        );
        const addPayments = await Promise.all(payments);

        return res.status(200).json({
          message: "Added session successfully",
          modifiedCount: updateResult.modifiedCount,
          paymentId: addPayments,
        });
      }
      // Use $addToSet to add unique session IDs to the array
    } catch (err) {
      console.log(err);
      res.status(400).json({ message: err.message });
    }
  }
);

app.delete("/delete-participant-enrolled-session", async (req, res) => {
  const { participantId, sessionId } = req.body;
  console.log("participantId", participantId);
  console.log("sessionId", sessionId);
  try {
    const participantResult = await db.collection("participants").updateOne(
      {
        _id: new ObjectId(participantId),
      },
      {
        $pull: { enrolled_session_id: new ObjectId(sessionId) },
      }
    );
    console.log("participantResult", participantResult);
    const paymentResult = await db.collection("payments").updateOne(
      {
        session_id: new ObjectId(sessionId),
        participant_id: new ObjectId(participantId),
      },
      {
        $set: { payment_status: "Cancelled" },
      }
    );

    console.log("paymentResult", paymentResult);
    return res.status(200).json({
      message: "Successfully Deleted",
      participantModified: participantResult.modifiedCount,
      paymentModified: paymentResult.modifiedCount,
    });
  } catch (err) {
    console.log("err", err);
    return res.status(400).json({
      message: "Failed to update documents",
      error: err.message,
    });
  }
});

// endpoint: /frontend/app/(private)/dashboard/page.js
app.post("/get-calendar-data", authorization_v2, async (req, res) => {
  const { merchantId } = req;
  console.log("get-calendar-data merchant id", merchantId);
  let sessionIdArray;
  try {
    // step1
    sessionIdArray = await getSessionByMerchant(merchantId);
  } catch (err) {
    console.log("get session error", err);
    return res
      .status(500)
      .json({ message: "Failed to get session", error: err });
  }
  let paymentInfoArray;
  try {
    //step 2: get payment info
    paymentInfoArray = await db
      .collection("payments")
      .find({
        session_id: { $in: sessionIdArray },
        payment_status: "Completed",
      })
      .toArray();
    // console.log("paymentInfoArray", paymentInfoArray);
  } catch (err) {
    console.log("get payment error", err);
    return res
      .status(500)
      .json({ message: "Failed to get payment info", error: err });
  }

  //step 3: merge all stuff to payment and group payment by date
  let addProgramIdToPayment;
  try {
    addProgramIdToPayment = paymentInfoArray.map(async (payment) => {
      const { programId, programName, programType, lesson_duration } =
        await getProgramName(payment.session_id);
      return {
        program_id: programId,
        program_name_zh: programName,
        program_type: programType,
        lesson_duration,
        session_id: payment.session_id,
        session_dates: await getSessionDate(payment.session_id),
      };
    });

    const groupedPaymentData = await Promise.all(addProgramIdToPayment);
    // console.log("groupedPaymentData", groupedPaymentData);
    const datesGroupedBySession = (
      await Promise.all(addProgramIdToPayment)
    ).reduce((acc, curr) => {
      curr.session_dates.forEach((date) => {
        let validDate;
        let originalTime = ""; // 儲存原始時間

        // 處理日期和時區轉換
        if (typeof date === "string") {
          // 保存原始的時間部分
          originalTime = date.split("T")[1].split(".")[0]; // 提取 "16:00:00" 部分

          // 創建一個 Date 對象並轉換為香港時區 (UTC+8)
          validDate = new Date(date);
          validDate = new Date(validDate.getTime() + 8 * 60 * 60 * 1000);
        } else if (date instanceof Date && !isNaN(date.getTime())) {
          originalTime = date.toISOString().split("T")[1].split(".")[0];
          validDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
        } else {
          console.warn("Invalid date encountered:", date);
          return;
        }

        // 格式化日期為 YYYY-MM-DD，使用香港時間
        const dateKey = validDate.toISOString().split("T")[0];

        if (!acc[dateKey]) {
          acc[dateKey] = {
            date: dateKey,
            sessions: {},
            total_count: 0,
          };
        }

        const sessionKey = curr.session_id;
        if (!acc[dateKey].sessions[sessionKey]) {
          // 轉換 UTC 時間到香港時間 (UTC+8)
          const [hours, minutes] = originalTime.split(":");
          const utcHours = parseInt(hours);
          const hkHours = (utcHours + 8) % 24; // 轉換為香港時間
          const session_startTime = `${hkHours
            .toString()
            .padStart(2, "0")}:${minutes}`; // 格式化為 "HH:MM"

          acc[dateKey].sessions[sessionKey] = {
            session_id: curr.session_id,
            program_id: curr.program_id,
            program_name: curr.program_name_zh,
            program_type: curr.program_type,
            lesson_duration: curr.lesson_duration,
            session_startTime: session_startTime, // 添加開始時間
            count: 0,
          };
        }

        acc[dateKey].sessions[sessionKey].count += 1;
        acc[dateKey].total_count += 1;
      });

      return acc;
    }, {});

    // 將結果轉換為所需格式

    res.status(200).json(datesGroupedBySession);
  } catch (err) {
    console.log("get program error", err);
    return res
      .status(500)
      .json({ message: "Internal Server Error", error: err });
  }
});

// endpoint: /frontend/app/(private)/dashboard/page.js
app.post("/get-revenue", authorization_v2, async (req, res) => {
  const { merchantId } = req;
  // console.log("get-revenue merchant id", merchantId);
  let sessionIdArray;
  try {
    // step1
    sessionIdArray = await getSessionByMerchant(merchantId);
  } catch (err) {
    console.log("get session error", err);
    return res
      .status(500)
      .json({ message: "Failed to get session", error: err });
  }
  let paymentInfoArray;
  try {
    //step 2: get payment info
    paymentInfoArray = await db
      .collection("payments")
      .find({
        session_id: { $in: sessionIdArray },
        payment_status: "Completed",
      })
      .toArray();
    // console.log("paymentInfoArray", paymentInfoArray);
  } catch (err) {
    console.log("get payment error", err);
    return res
      .status(500)
      .json({ message: "Failed to get payment info", error: err });
  }
  // step 2.5:
  // use session id find all session dates, divide into 3

  //step 3: merge all stuff to payment and group payment by date
  let addProgramIdToPayment;
  try {
    addProgramIdToPayment = paymentInfoArray.map(async (payment) => {
      const { programId, programName, programType } = await getProgramName(
        payment.session_id
      );
      return {
        ...payment,
        program_id: programId,
        program_name_zh: programName,
        program_type: programType,
        session_dates: await getSessionDate(payment.session_id),
      };
    });

    const groupedPaymentData = await Promise.all(addProgramIdToPayment);
    // console.log("groupedPaymentData", groupedPaymentData);
    const datesGroupedBySession = (
      await Promise.all(addProgramIdToPayment)
    ).reduce((acc, curr) => {
      const amountPerDate = curr.amount / curr.session_dates.length; // 計算每個日期的金額

      // curr.session_dates.forEach((date) => {
      //   // 檢查日期的有效性
      //   let validDate;

      //   // 如果是字符串，則將其轉換為 Date 對象
      //   if (typeof date === "string") {
      //     validDate = new Date(date);
      //   } else if (date instanceof Date && !isNaN(date.getTime())) {
      //     validDate = date; // 有效的 Date 對象
      //   } else {
      //     console.warn("Invalid date encountered:", date);
      //     return; // 跳過無效日期
      //   }
      //   console.log("date", date);
      //   const dateKey = validDate.toISOString().split("T")[0]; // 使用有效的日期

      //   if (!acc[dateKey]) {
      //     acc[dateKey] = {
      //       date: dateKey,
      //       sessions: {},
      //       total_count: 0,
      //     };
      //   }

      //   const sessionKey = curr.session_id; // 僅用session_id作為鍵
      //   if (!acc[dateKey].sessions[sessionKey]) {
      //     acc[dateKey].sessions[sessionKey] = {
      //       session_id: curr.session_id,
      //       program_name: curr.program_name_zh,
      //       program_type: curr.program_type,
      //       total_amount: 0, // 用於累加金額
      //       count: 0,
      //     };
      //   }

      //   acc[dateKey].sessions[sessionKey].total_amount += amountPerDate; // 將金額加到對應的session
      //   acc[dateKey].sessions[sessionKey].count += 1; // 計算每個session的次數
      //   acc[dateKey].total_count += 1; // 每個日期的總計數
      // });
      curr.session_dates.forEach((date) => {
        // 检查日期的有效性
        let validDate;

        // 如果是字符串，则将其转换为 Date 对象
        if (typeof date === "string") {
          validDate = new Date(date);
        } else if (date instanceof Date && !isNaN(date.getTime())) {
          validDate = date; // 有效的 Date 对象
        } else {
          console.warn("Invalid date encountered:", date);
          return; // 跳过无效日期
        }

        // console.log("Original UTC date:", validDate.toISOString());

        // 转换为香港时区的时间
        const hkDate = new Date(validDate.getTime() + 8 * 60 * 60 * 1000); // 加 8 小时
        // console.log("Converted HK date:", hkDate.toISOString());

        const dateKey = hkDate.toISOString().split("T")[0]; // 使用香港时区的日期

        if (!acc[dateKey]) {
          acc[dateKey] = {
            date: dateKey,
            sessions: {},
            total_count: 0,
          };
        }

        const sessionKey = curr.session_id; // 仅用 session_id 作为键
        if (!acc[dateKey].sessions[sessionKey]) {
          acc[dateKey].sessions[sessionKey] = {
            session_id: curr.session_id,
            program_name: curr.program_name_zh,
            program_type: curr.program_type,
            total_amount: 0, // 用于累加金额
            count: 0,
          };
        }

        acc[dateKey].sessions[sessionKey].total_amount += amountPerDate; // 将金额加到对应的 session
        acc[dateKey].sessions[sessionKey].count += 1; // 计算每个 session 的次数
        acc[dateKey].total_count += 1; // 每个日期的总计数
      });

      return acc;
    }, {});
    // 將結果轉換為所需格式
    const resultBySessionDate = Object.values(datesGroupedBySession).flatMap(
      (dateGroup) =>
        Object.values(dateGroup.sessions).map((session) => ({
          date: dateGroup.date,
          session_id: session.session_id,
          program_name: session.program_name,
          total_amount: Math.floor(session.total_amount), // 每個session的金額
          total_count: session.count, // 此處的count指的是該session的次數
          program_type: session.program_type,
        }))
    );

    // 根據日期進行排序
    resultBySessionDate.sort((a, b) => new Date(a.date) - new Date(b.date));

    // console.log("resultBySessionDate", resultBySessionDate);

    // Group by date
    const groupedByDate = resultBySessionDate.reduce((acc, curr) => {
      const { date, total_amount, total_count } = curr;

      if (!acc[date]) {
        acc[date] = {
          date: date,
          total_amount: 0,
          total_count: 0,
        };
      }

      acc[date].total_amount += total_amount; // 累加總金額
      acc[date].total_count += total_count; // 累加總計數

      return acc;
    }, {});

    // 將結果轉換為數組格式
    const resultGroupedByDate = Object.values(groupedByDate);
    // console.log("resultGroupedByDate", resultGroupedByDate);

    const yearMonthAggregatedData = resultGroupedByDate.reduce(
      (acc, { date, total_amount, total_count }) => {
        const yearMonth = date.slice(0, 7); // 獲取 'YYYY-MM'

        if (!acc[yearMonth]) {
          acc[yearMonth] = { total_amount: 0, total_count: 0 };
        }

        acc[yearMonth].total_amount += total_amount; // 累加金額
        acc[yearMonth].total_count += total_count; // 累加計數
        return acc;
      },
      {}
    );
    // console.log("yearMonthAggregatedData", yearMonthAggregatedData);
    const resultGroupedByYearMonthGeneric = Object.entries(
      yearMonthAggregatedData
    ).map(([yearMonth, { total_amount, total_count }]) => ({
      year_month: yearMonth,
      total_amount,
      total_count,
    }));

    // console.log(
    //   "resultGroupedByYearMonthGeneric",
    //   resultGroupedByYearMonthGeneric
    // );

    // 在 yearMonthAggregatedData 之後，進行 program_name 和 program_type 的聚合
    const programAggregatedData = {};

    resultBySessionDate.forEach(
      ({ date, total_amount, program_name, program_type }) => {
        const yearMonth = date.slice(0, 7); // 獲取 'YYYY-MM'

        if (!programAggregatedData[yearMonth]) {
          programAggregatedData[yearMonth] = {
            program_names: {},
            program_types: {},
          };
        }

        // 聚合 program_name
        if (!programAggregatedData[yearMonth].program_names[program_name]) {
          programAggregatedData[yearMonth].program_names[program_name] = 0;
        }
        programAggregatedData[yearMonth].program_names[program_name] +=
          total_amount;

        // 聚合 program_type
        if (!programAggregatedData[yearMonth].program_types[program_type]) {
          programAggregatedData[yearMonth].program_types[program_type] = 0;
        }
        programAggregatedData[yearMonth].program_types[program_type] +=
          total_amount;
      }
    );

    // 整合到 resultGroupedByYearMonth
    const resultGroupedByYearMonth = Object.entries(
      yearMonthAggregatedData
    ).map(([yearMonth, { total_amount, total_count }]) => {
      const programNames =
        programAggregatedData[yearMonth]?.program_names || {};
      const programTypes =
        programAggregatedData[yearMonth]?.program_types || {};

      // 動態生成字段
      const result = {
        year_month: yearMonth,
        total_amount,
        total_count,
      };

      // 將 programNames 和 programTypes 添加到結果中
      Object.entries(programNames).forEach(([name, amount]) => {
        result[name] = amount;
      });

      Object.entries(programTypes).forEach(([type, amount]) => {
        result[type] = amount;
      });

      return result;
    });

    // 分別存放 program types 和 names，並包含 year_month
    const resultGroupedByYearMonth_programNames = Object.entries(
      programAggregatedData
    ).reduce((acc, [yearMonth, { program_names }]) => {
      const existingEntry =
        acc.find((entry) => entry.year_month === yearMonth) || {};
      let total = 0;

      Object.entries(program_names).forEach(([name, amount]) => {
        existingEntry[name] = amount; // 合併 program names
        total += amount; // 計算總和
      });

      if (!existingEntry.year_month) {
        existingEntry.year_month = yearMonth; // 設定 year_month
      }

      existingEntry.All_Programs = total; // 添加總和

      if (!acc.includes(existingEntry)) {
        acc.push(existingEntry); // 如果不存在，新增條目
      }

      return acc;
    }, []);

    const resultGroupedByYearMonth_programTypes = Object.entries(
      programAggregatedData
    ).reduce((acc, [yearMonth, { program_types }]) => {
      const existingEntry =
        acc.find((entry) => entry.year_month === yearMonth) || {};
      let total = 0;

      Object.entries(program_types).forEach(([type, amount]) => {
        existingEntry[type] = amount; // 合併 program types
        total += amount; // 計算總和
      });

      if (!existingEntry.year_month) {
        existingEntry.year_month = yearMonth; // 設定 year_month
      }

      existingEntry.All_Types = total; // 添加總和

      if (!acc.includes(existingEntry)) {
        acc.push(existingEntry); // 如果不存在，新增條目
      }

      return acc;
    }, []);

    // 按 program_name 分組
    const resultGroupedByYearMonth_programNames_participant =
      resultBySessionDate.reduce((acc, curr) => {
        const yearMonth = curr.date.slice(0, 7); // 提取年月
        if (!acc[yearMonth]) acc[yearMonth] = { year_month: yearMonth };

        const programName = curr.program_name;
        acc[yearMonth][programName] =
          (acc[yearMonth][programName] || 0) + curr.total_count;

        return acc;
      }, {});

    // 格式化為陣列
    const resultGroupedByYearMonth_programNames_participantArray =
      Object.values(resultGroupedByYearMonth_programNames_participant);

    // 按 program_type 分組
    const resultGroupedByYearMonth_programTypes_participant =
      resultBySessionDate.reduce((acc, curr) => {
        const yearMonth = curr.date.slice(0, 7); // 提取年月
        if (!acc[yearMonth]) acc[yearMonth] = { year_month: yearMonth };

        const programType = curr.program_type;
        acc[yearMonth][programType] =
          (acc[yearMonth][programType] || 0) + curr.total_count;

        return acc;
      }, {});

    // 格式化為陣列
    const resultGroupedByYearMonth_programTypes_participantArray =
      Object.values(resultGroupedByYearMonth_programTypes_participant);

    // console.log(
    //   "resultGroupedByYearMonth_programNames",
    //   resultGroupedByYearMonth_programNames
    // );
    // console.log(
    //   "resultGroupedByYearMonth_programTypes",
    //   resultGroupedByYearMonth_programTypes
    // );

    // console.log(
    //   "resultGroupedByYearMonth_programNames_participantArray",
    //   resultGroupedByYearMonth_programNames_participantArray
    // );
    // console.log(
    //   "resultGroupedByYearMonth_programTypes_participantArray",
    //   resultGroupedByYearMonth_programTypes_participantArray
    // );

    // 最終結果
    const revenueCombinedResult = {
      resultGroupedByYearMonth,
      resultGroupedByYearMonth_programNames,
      resultGroupedByYearMonth_programTypes,
      resultGroupedByYearMonth_programNames_participantArray,
      resultGroupedByYearMonth_programTypes_participantArray,
    };
    // console.log("revenueCombinedResult", revenueCombinedResult);
    // 返回結果
    // console.log("revenueCombinedResult", revenueCombinedResult);
    res.json(revenueCombinedResult);
  } catch (err) {
    console.log("get program error", err);
    return res
      .status(500)
      .json({ message: "Internal Server Error", error: err });
  }
});

// get sessions id array by your merchant
async function getSessionByMerchant(merchantId) {
  try {
    const programs_result = await db
      .collection("programs")
      .find({
        merchant_id: new ObjectId(merchantId),
      })
      .project({ _id: 1 })
      .toArray();
    const programIdArray = programs_result.map(({ _id }) => {
      return _id;
    });
    const sessions_result = await db
      .collection("programs_sessions")
      .find({ program_id: { $in: programIdArray } })
      .project({ _id: 1 })
      .toArray();

    const sessionsIdArray = sessions_result.map(({ _id }) => {
      return _id;
    });
    return sessionsIdArray;
  } catch (err) {
    console.log(err);
    return "failed to get session id by merchant";
  }
}

// endpoint: /frontend/app/(private)/dashboard/page.js
async function getProgramName(sessionId) {
  try {
    const getProgramId = await db
      .collection("programs_sessions")
      .find({ _id: new ObjectId(sessionId) })
      .toArray();
    // console.log("getProgramId", getProgramId);
    const programId = getProgramId.map((session) => session.program_id);

    // console.log("programId", programId);
    const programResult = await db
      .collection("programs")
      .find({ _id: { $in: programId } })
      .toArray();

    // console.log("programResult", programResult);
    const programInfo = programResult.map((program) => {
      return {
        programName: program.program_name_zh,
        programType: program.program_type,
        programId: program._id,
        lesson_duration: program.lesson_duration,
      };
    });
    return programInfo[0];
  } catch (err) {
    console.log(err);
  }
}

// endpoint: /frontend/app/(private)/dashboard/page.js
async function getSessionDate(sessionId) {
  try {
    const sessionInfo = await db
      .collection("programs_sessions")
      .find({ _id: sessionId })
      .toArray();
    const sessionDates = sessionInfo.map((session) => session.session_dates);
    return sessionDates[0];
  } catch (err) {
    console.log(err);
  }
}

app.post(
  "/get-participants-per-program",
  authorization_v2,
  async (req, res) => {
    const { merchantId } = req;

    try {
      const sessionIdArray = await getSessionByMerchant(merchantId);
      // console.log("sessionIdArray", sessionIdArray);
      const participants_result = await db
        .collection("participants")
        .find({
          enrolled_session_id: { $in: sessionIdArray },
        })
        .project({
          _id: 1,
          participant_name: 1,
          telephone_no: 1,
          enrolled_session_id: {
            $filter: {
              input: "$enrolled_session_id", // 過濾來源陣列
              as: "sessionId", // 循環變數名稱
              cond: { $in: ["$$sessionId", sessionIdArray] }, // 只保留匹配的 ID
            },
          },
        })
        .toArray();
      const groupedParticipant = participants_result.map((participant) => {
        const testObj = {};
        participant.enrolled_session_id.forEach(
          (date) => (testObj[date] = [participant._id])
        );
        return { ...testObj };
      });
      console.log("groupedParticipant", groupedParticipant);
    } catch (err) {
      console.log(err);
      // res.send(err);
      res.json({ message: err });
    }
  }
);

// get the participant details from the 'Participants' collection
// endpoint: /frontend/app/(private)/dashboard/payment/page.js
async function getParticipantDetails(participantId) {
  try {
    const participantInfo = await db
      .collection("participants")
      .find({ _id: participantId })
      .toArray();
    // Since it is an array of object, so we need [0] to return the object
    // and the we can just use obj[key] to get the value
    return participantInfo[0];
  } catch (err) {
    console.log("get participants error", err);
  }
}

// retrieve the payment collections
// endpoint: /frontend/app/(private)/dashboard/payment/page.js
app.post("/get-payment-info", authorization_v2, async (req, res) => {
  const { merchantId } = req;
  let sessionIdArray = [];
  // Step 1
  try {
    sessionIdArray = await getSessionByMerchant(merchantId);
  } catch (err) {
    console.log("get session error", err);
    return res.status(500).json({ message: "Error retrieving sessions." });
  }
  // console.log("session id", sessionIdArray);
  console.log("Reach here backend2");

  // Step 2
  let paymentInfoArray;
  try {
    paymentInfoArray = await db
      .collection("payments")
      .find({ session_id: { $in: sessionIdArray } })
      .toArray();
    // console.log("paymentInfoArray", paymentInfoArray);
  } catch (err) {
    console.log("get payment error", err);
    return res.status(500).json({ message: "Error retrieving payments." });
  }

  // console.log("Here is the payment info", paymentInfoArray);

  // Step 3
  // const participantIds = paymentInfoArray.map((payment) => {
  //   return payment.participant_id;
  // });

  let combinedPaymentDetail;
  try {
    combinedPaymentDetail = await Promise.all(
      paymentInfoArray.map(async (payment) => {
        const participantDetails = await getParticipantDetails(
          payment.participant_id
        );

        console.log("The DETAIL IS: ", participantDetails);
        console.log("THE ID IS :", participantDetails.participant_name);

        return {
          ...payment,
          program_name_zh: (await getProgramName(payment.session_id))
            .programName,
          participant_name: participantDetails.participant_name,
          telephone_no: participantDetails.telephone_no,
          session_dates: await getSessionDate(payment.session_id),
        };
      })
    );
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ message: "Error combining payment details." });
  }
  console.log("Reach here backend4");

  // console.log(combinedPaymentDetail);
  return res.json(combinedPaymentDetail);
});

// update the payment status fr
// endpoint: /frontend/app/(private)/dashboard/payment/page.js
app.post("/update-payment-status", authorization_v2, async (req, res) => {
  const { participant_id, payment_status } = req.body;
  console.log(participant_id);
  console.log(payment_status);

  try {
    const result = await db
      .collection("payments")
      .updateOne(
        { participant_id: new ObjectId(participant_id) },
        { $set: { payment_status: payment_status } }
      );
    console.log("reach here");
    return res.status(200).json({ message: "Payment status is updated!!" });
  } catch (err) {
    return res.status(500).json({ message: "Database server error", error });
  }
});

// update the payment status
// endpoint: /frontend/app/(private)/dashboard/payment/page.js
app.post("/update-payment-status2", authorization_v2, async (req, res) => {
  const { _id, payment_status } = req.body;

  try {
    const result = await db
      .collection("payments")
      .updateOne(
        { _id: new ObjectId(_id) },
        { $set: { payment_status: payment_status } }
      );
    console.log("reach here");
    return res.status(200).json({ message: "Payment status is updated!!" });
  } catch (err) {
    return res.status(500).json({ message: "Database server error", error });
  }
});

// purpose: participant return to payment page + generate invoice
// endpoint: unknown
app.post("/get-invoice-info", async (req, res) => {
  const { paymentId } = req.body; // 真做
  // const paymentId = "6735c9e179cf817c02634e53"; // demo
  let payment_result;
  try {
    payment_result = await db
      .collection("payments")
      .find({ _id: new ObjectId(paymentId) })
      .project({
        _id: 1,
        payment_method: 1,
        payment_status: 1,
        participant_id: 1,
        session_id: 1,
        amount: 1,
      })
      .toArray();
  } catch (err) {
    res.json({ message: "fail to fetch payment result", error: err });
  }
  let participant_result;
  try {
    participant_result = await db
      .collection("participants")
      .find({ _id: payment_result[0].participant_id })
      .project({ _id: 0, participant_name: 1, telephone_no: 1 })
      .toArray();
  } catch (err) {
    res.json({ message: "fail to fetch participant_result", error: err });
  }
  let session_result;
  try {
    session_result = await db
      .collection("programs_sessions")
      .find({ _id: payment_result[0].session_id })
      .project({ _id: 0, session_dates: 1, program_id: 1 })
      .toArray();
  } catch (err) {
    res.json({ message: "fail to fetch session_result", error: err });
  }
  let program_result;
  try {
    program_result = await db
      .collection("programs")
      .find({ _id: session_result[0].program_id })
      .project({
        _id: 0,
        program_name_zh: 1,
        lesson_duration: 1,
        merchant_id: 1,
      })
      .toArray();
  } catch (err) {
    res.json({ message: "fail to fetch program_result", error: err });
  }
  let merchant_result;
  try {
    merchant_result = await db
      .collection("merchants")
      .find({ _id: program_result[0].merchant_id })
      .project({ _id: 1, payment_number: 1 })
      .toArray();

    res.json({
      payment_id: payment_result[0]._id,
      participant_name: participant_result[0].participant_name,
      telephone_no: participant_result[0].telephone_no,
      program_name_zh: program_result[0].program_name_zh,
      session_dates: session_result[0].session_dates,
      lesson_duration: program_result[0].lesson_duration,
      payment_method: payment_result[0].payment_method,
      amount: payment_result[0].amount,
      payment_status: payment_result[0].payment_status,
      payment_number: merchant_result[0].payment_number,
    });
  } catch (err) {
    res.json({ message: "fail to fetch merchant_result", error: err });
  }
});

// update merchant payment details
// endpoint: /frontend/app/(private)/profile/page.js

app.post("/update-payment-details", authorization_v2, async (req, res) => {
  console.log("reach here");
  const { username, fpsNumber, payMeNumber } = req.body;
  try {
    const updateData = {};
    if (fpsNumber) {
      updateData["payment_number.fps"] = fpsNumber;
    } else if (payMeNumber) {
      updateData["payment_number.payme"] = payMeNumber;
    }

    console.log(username, fpsNumber, payMeNumber);

    const result = await User.updateOne(
      { merchant_username: username },
      { $set: updateData }
    );

    console.log("the result is", result);
    console.log("FPS reach here");
    return res.status(200).json({ message: "Payment details updated" });
  } catch (error) {
    return res.status(400).json({ message: "Database Error" });
  }
});

//payment change status from "pending" to "received" (endpoint: /payment/${payment_id})
app.post("/api/update-payment-status", async (req, res) => {
  try {
    const { payment_id, status, payment_method } = req.body;

    // Validate required fields
    if (!payment_id || !status || !payment_method) {
      return res.status(400).json({
        success: false,
        message: "Payment ID, status, and payment method are required",
      });
    }

    // Connect to payments collection
    const db = client.db("information");
    const payments = db.collection("payments");

    console.log("Received payment_id:", payment_id);
    console.log("Updating status to:", status);
    console.log("Updating payment method to:", payment_method);

    // Update payment status and method
    const result = await payments.updateOne(
      { _id: new ObjectId(payment_id) },
      {
        $set: {
          payment_status: status,
          payment_method: payment_method, // Update the payment method
          updated_at: new Date(),
        },
      }
    );

    console.log("Matched Count:", result.matchedCount);
    console.log("Modified Count:", result.modifiedCount);

    // Check if payment was found and updated
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Return success response
    return res.status(200).json({
      success: true,
      message: "Payment status and method updated successfully",
    });
  } catch (error) {
    console.error("Error updating payment status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update payment status",
      error: error.message,
    });
  }
});

app.post("/get-participant-by-session", async (req, res) => {
  const { sessionId } = req.body;

  try {
    const payment_result = await db
      .collection("payments")
      .find({
        session_id: new ObjectId(sessionId),
        payment_status: "Completed",
      })
      .project({ participant_id: 1, session_id: 1, _id: 1 })
      .toArray();

    const participantIds = payment_result.map(
      (payment) => payment.participant_id
    );
    // console.log("participantIds", participantIds);
    const participant_result = await db
      .collection("participants")
      .find({ _id: { $in: participantIds } })
      .project({ participant_name: 1, telephone_no: 1 })
      .toArray();

    res.status(200).json(participant_result);
  } catch (err) {
    console.log(err);
    res.status(400).json(err);
  }
});

app.listen(port, () => {
  console.log(`listening to ${port}`);
});
