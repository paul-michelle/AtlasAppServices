const cout = (msg) => void console.log(msg);

exports = async changeEvent => {
  const client = context.services.get("mongodb-atlas");
  const collection = client.db("sample_geospatial").collection("changeEvents");
  const { insertedId } = await collection.insertOne(changeEvent);
  cout(`A change to the collection has been saved as a document with _id ${insertedId}`);
};
