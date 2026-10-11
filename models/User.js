const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = new mongoose.Schema(
  {
    address: { type: String, trim: true },
    street: { type: String, trim: true },
    village: { type: String, trim: true },
    pincode: { type: String, trim: true },
    latitude: Number,
    longitude: Number,
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      trim: true,
      minlength: 3,
      maxlength: 40,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    age: {
      type: Number,
      required: [true, 'Age is required'],
      min: [1, 'Age must be valid'],
      max: [120, 'Age must be valid'],
    },
    dob: {
      type: Date,
      // Required only when age >= 18 — enforced in the validator (routes/auth.js)
      // and re-checked here as a defensive backstop.
      validate: {
        validator: function (value) {
          if (this.age >= 18) return !!value;
          return true;
        },
        message: 'Date of birth is required for users 18 or older',
      },
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      // Normalized Indian mobile number in +91XXXXXXXXXX form
      match: [/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number'],
      unique: true,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: false, // activated only after OTP verification
    },
    savedAddress: addressSchema,
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function (plainPassword) {
  const salt = await bcrypt.genSalt(12);
  this.passwordHash = await bcrypt.hash(plainPassword, salt);
};

userSchema.methods.verifyPassword = function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
