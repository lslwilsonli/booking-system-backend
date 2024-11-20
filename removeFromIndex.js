// merchant id authorization
function authorization(token) {
  // current decode part
  if (!token) {
    return res.status(403).json({ message: "No token provided." });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("decoded.payload", decoded);
    // const data = decoded.payload;
    const merchantId = decoded.payload.merchant_id;
    return merchantId;
    // console.log("decoded.payload", data);
    // if (!merchant_username || typeof merchant_username !== "string") {
    //   return res.status(400).json({ message: "Invalid username." });
    // }

    // Fetch user data from the database
    // const user = await User.findOne({ merchant_username });
    // merchantId = user._id;
    // console.log(user);
  } catch (error) {
    console.log(error);
  }
}

// use for generate button in front end
// to-do
// fetch programs by type
app.get("/get-programs-type/:merchantId", async (req, res) => {
  const { merchantId } = req.params;
  try {
    const programs_result = await db
      .collection("programs")
      .find({
        merchant_id: new ObjectId(merchantId),
      })
      .project({ program_type: 1, _id: 0 })
      .toArray();
    // console.log("before set", programs_result);
    const programIdArray = programs_result.map(({ program_type }) => {
      return program_type;
    });
    const programIdArray_Set = [...new Set(programIdArray)];
    // console.log("after set", programIdArray_Set);
    res.json(programIdArray_Set);
  } catch (err) {
    console.log(err);
    res.send(err);
  }
});

// fetch programs session by type + matched with all subtype
// receive = user selected type / sub types in front end
// use the received input to check = use program-session-programId ge type, subtype match with program collection
// Progress: WIP
// example: http://localhost:3030/programs-sessions/672b7749fa8bcf1cc05e8cf6
app.get("/programs-sessions/:programId", async (req, res) => {
  const { programId } = req.params;
  try {
    const result = await db
      .collection("programs_sessions")
      .find({ program_id: new ObjectId(programId) })
      .toArray();
    console.log("succeed to get program-session");

    // better to use ObjectIdValid?
    result.length === 0 &&
      res.send(`Program Id ${programId} is not found in program`);
    res.send(result);
  } catch (err) {
    console.log(err);
    res.send("failed to get program-session");
  }
});
