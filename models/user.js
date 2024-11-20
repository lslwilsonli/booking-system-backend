const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const Schema = mongoose.Schema;
// 使用 new Schema() 宣告資料
const userSchema = new Schema({
  merchant_username: {
    type: String,
    required: true,
    unique: true,
  },
  merchant_email: {
    type: String,
    required: true,
    unique: true,
  },
  telephone_no: {
    type: String,
    required: true,
  },
  organization: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
  },
  subscription_period: {
    type: String,
    default: "",
  },
  payment_number: {
    type: Object,
    default: {},
  },
  payment_image: {
    type: Object,
    default: {},
  },
  created_program_id: {
    type: Array,
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now, // get the timestamp
  },
});

userSchema.pre("save", async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified("password")) {
    return next();
  }
  try {
    const hashedPassword = await bcrypt.hash(this.password, 10); // salt rounds of 10
    console.log("The hashedPassword is :", hashedPassword);
    this.password = hashedPassword;
    next();
  } catch (error) {
    return next(error);
  }
});

module.exports = mongoose.model("merchants", userSchema);
