const fs = require('fs').promises; // Using promises for fs operations

process.argv.shift(); // Remove the first element (node) from arguments
process.argv.shift(); // Remove the second element (script path) from arguments

if (process.argv.length < 1) {
  console.error("Usage: node script.js <image_path> <prompt_text>");
  process.exit(1);
}

const imagePath = process.argv[0];
const promptText = process.argv[1];

function sendImageToServer(imagePath, prompt = "What is in this picture?") {
  return fs.readFile(imagePath)
    .then(imageData => {
      const base64Data = Buffer.from(imageData).toString('base64');

      const data = {
        model: "llava",
        prompt,
        images: [base64Data]
      };

      const postData = JSON.stringify(data);

      const options = {
        method: 'POST',
        body: postData,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      return fetch(`http://localhost:11434/api/generate`, options);
    })
    .then(response => {
      if (!response.body) {
        console.error("Error: No response body");
        return;
      }

      const reader = response.body.getReader();
      const utf8Decoder = new TextDecoder();

      return readStream(reader, utf8Decoder);
    })
    .then(data => {
      console.log('Server response:', data);
    })
    .catch(error => {
      console.error('Error:', error);
    });
}

async function readStream(reader, decoder) {
  let result = await reader.read();
  while (!result.done) {
    const chunk = decoder.decode(result.value);
    const data = JSON.parse(chunk);
    process.stdout.write(data.response);
    result = await reader.read();
  }
  console.log("\n"); // Add a newline after processing the entire stream
}

sendImageToServer(imagePath, promptText);
