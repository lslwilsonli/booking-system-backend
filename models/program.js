const { ObjectId, Decimal128, Int32 } = require("bson");
const mongoose = require("mongoose");

const Schema = mongoose.Schema;
// 使用 new Schema() 宣告資料
const programSchema = new Schema({
  program_name_zh: {
    type: String,
    required: true,
  },
  program_type: {
    type: String,
    required: true,
  },
  program_subtype: {
    type: Object,
    default: {},
  },
  program_image: {
    type: Array,
    default: [],
  },
  description: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now, // get the timestamp
  },
  program_notice: {
    type: String,
  },
  merchant_id: {
    type: ObjectId,
    default: "",
  },
  program_price_per_lesson: {
    type: Decimal128,
  },
  lesson_duration: {
    type: Number,
  },
});

module.exports = mongoose.model("programs", programSchema);
