const axios = require('axios');

axios.post('https://55e0-34-81-5-31.ngrok.io/', {
    fileName: "buggyFile.php",
    numOfPatches: 5,
    fileLines: ['a','b','c']
})
  .then(function (response) {
    // handle success
    console.log(response.data['patches']);
  })
  .catch(function (error) {
    // handle error
    console.log(error);
  })
  .finally(function () {
    // always executed
  });