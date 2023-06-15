exports = function(changeEvent) {
  const {fullDocument} = changeEvent;
  console.log({fullDocument: JSON.stringify(fullDocument, null, 2)});
  
  
  console.log({changeEvent: JSON.stringify(changeEvent, null, 2)});
  
};
