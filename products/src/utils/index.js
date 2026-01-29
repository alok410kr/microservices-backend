const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const amqplib = require("amqplib");
const { v4: uuid4 } = require("uuid");
const {
  APP_SECRET,
  BASE_URL,
  EXCHANGE_NAME,
  MSG_QUEUE_URL,
} = require("../config");

let amqplibConnection = null;

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

let connectionFailed = false;

const getChannel = async () => {
  if (connectionFailed) return null;
  if (amqplibConnection === null) {
    try {
      amqplibConnection = await connectWithTimeout(MSG_QUEUE_URL, 5000);
    } catch (err) {
      connectionFailed = true;
      throw err;
    }
  }
  return await amqplibConnection.createChannel();
};

module.exports.CreateChannel = async () => {
  try {
    const channel = await getChannel();
    await channel.assertQueue(EXCHANGE_NAME, "direct", { durable: true });
    console.log("RabbitMQ Connected");
    return channel;
  } catch (err) {
    console.log("RabbitMQ Connection Failed - Running without message queue");
    console.log("Error:", err.message);
    return null;
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

module.exports.RPCObserver = async (RPC_QUEUE_NAME, service) => {
  try {
    const channel = await getChannel();
    if (!channel) {
      console.log("RPC Observer skipped - No message queue available");
      return;
    }
    await channel.assertQueue(RPC_QUEUE_NAME, {
      durable: false,
    });
    channel.prefetch(1);
    channel.consume(
      RPC_QUEUE_NAME,
      async (msg) => {
        if (msg.content) {
          // DB Operation
          const payload = JSON.parse(msg.content.toString());
          const response = await service.serveRPCRequest(payload);
          channel.sendToQueue(
            msg.properties.replyTo,
            Buffer.from(JSON.stringify(response)),
            {
              correlationId: msg.properties.correlationId,
            }
          );
          channel.ack(msg);
        }
      },
      {
        noAck: false,
      }
    );
  } catch (err) {
    console.log("RPC Observer failed to start:", err.message);
  }
};
