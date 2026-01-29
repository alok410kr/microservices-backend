const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const amqplib = require("amqplib");

const {
  APP_SECRET,
  EXCHANGE_NAME,
  CUSTOMER_SERVICE,
  MSG_QUEUE_URL,
} = require("../config");

//Utility functions
(module.exports.GenerateSalt = async () => {
  return await bcrypt.genSalt();
}),
  (module.exports.GeneratePassword = async (password, salt) => {
    return await bcrypt.hash(password, salt);
  });

module.exports.ValidatePassword = async (
  enteredPassword,
  savedPassword,
  salt
) => {
  return (await this.GeneratePassword(enteredPassword, salt)) === savedPassword;
};

(module.exports.GenerateSignature = async (payload) => {
  return await jwt.sign(payload, APP_SECRET, { expiresIn: "1d" });
}),
  (module.exports.ValidateSignature = async (req) => {
    const signature = req.get("Authorization");

    if (signature) {
      const payload = await jwt.verify(signature.split(" ")[1], APP_SECRET);
      req.user = payload;
      return true;
    }

    return false;
  });

module.exports.FormateData = (data) => {
  if (data) {
    return { data };
  } else {
    throw new Error("Data Not found!");
  }
};

//Message Broker
const connectWithTimeout = (url, timeout = 5000) => {
  return Promise.race([
    amqplib.connect(url),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    )
  ]);
};

module.exports.CreateChannel = async () => {
  try {
    const connection = await connectWithTimeout(MSG_QUEUE_URL, 5000);
    const channel = await connection.createChannel();
    await channel.assertQueue(EXCHANGE_NAME, "direct", { durable: true });
    console.log("RabbitMQ Connected");
    return channel;
  } catch (err) {
    console.log("RabbitMQ Connection Failed - Running without message queue");
    console.log("Error:", err.message);
    return null; // Return null instead of throwing, allowing app to run without MQ
  }
};

module.exports.PublishMessage = (channel, service, msg) => {
  if (!channel) {
    console.log("Message queue not available, skipping publish:", msg);
    return;
  }
  channel.publish(EXCHANGE_NAME, service, Buffer.from(msg));
  console.log("Sent: ", msg);
};

module.exports.SubscribeMessage = async (channel, service) => {
  if (!channel) {
    console.log("Subscribe skipped - No message queue available");
    return;
  }
  await channel.assertExchange(EXCHANGE_NAME, "direct", { durable: true });
  const q = await channel.assertQueue("", { exclusive: true });
  console.log(` Waiting for messages in queue: ${q.queue}`);

  channel.bindQueue(q.queue, EXCHANGE_NAME, CUSTOMER_SERVICE);

  channel.consume(
    q.queue,
    (msg) => {
      if (msg.content) {
        console.log("the message is:", msg.content.toString());
        service.SubscribeEvents(msg.content.toString());
      }
      console.log("[X] received");
    },
    {
      noAck: true,
    }
  );
};
