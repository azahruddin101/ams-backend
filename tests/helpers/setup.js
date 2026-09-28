// Must be imported before any src module: points the app at an isolated test database.
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017/ams_test";
