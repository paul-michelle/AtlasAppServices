exports = function(changeEvent) {
  const event = JSON.stringify(changeEvent, null, 2);
  console.log(event);
};
