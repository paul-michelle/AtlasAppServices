exports = function(changeEvent) {
  const event = JSON.stringify(changeEvent.fullDocument, null, 2);
  console.log(event);
};
