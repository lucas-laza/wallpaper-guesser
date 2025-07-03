import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { IsEmail, Validate } from "class-validator";
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

@Entity()
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: false })
  name!: string;

  @Column({ nullable: false, unique: true })
  @Validate(IsEmail, { message: "Invalid email" })
  email!: string;

  @Column({ nullable: false })
  password!: string;

  @Column({ nullable: false, default: 'user' })
  role!: string;

  private static async createNew(name: string, email: string, _password: string, role: string = 'user') {
    const user = new User();
    user.name = name;
    user.email = email;
    user.password = await User.hashPassword(_password);
    user.role = role;
    await user.save();
    return user;
  }

  static async getALL(){
    return await this.find();
  }

  static async verifyUserCreation(_name: string, _email: string, _password: string, _repassword: string, _role: string = 'user'): Promise<any> {
    // Validation des champs requis d'abord
    if (!_name || typeof _name !== 'string') {
      return {
        "code": 400,
        "message": "Name is required and must be a string"
      };
    }

    if (!_email || typeof _email !== 'string') {
      return {
        "code": 400,
        "message": "Email is required and must be a string"
      };
    }

    if (!_password || typeof _password !== 'string') {
      return {
        "code": 400,
        "message": "Password is required and must be a string"
      };
    }

    if (!_repassword || typeof _repassword !== 'string') {
      return {
        "code": 400,
        "message": "Password confirmation is required and must be a string"
      };
    }

    // Nettoyer les données (trim whitespace)
    _name = _name.trim();
    _email = _email.trim();

    // Validation de la longueur du nom
    if (_name.length < 3 || _name.length > 32) {
      return {
        "code": 400,
        "message": "Name must have at least 3 characters and at most 32 characters"
      };
    }

    // Validation du format email avec regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(_email)) {
      return {
        "code": 400,
        "message": "Invalid email format"
      };
    }

    // Vérifier l'unicité de l'email
    try {
      const existingUser = await User.findOneBy({ email: _email });
      if (existingUser) {
        return {
          "code": 400,
          "message": "Email is already in use"
        };
      }
    } catch (error) {
      console.error("Database error checking email uniqueness:", error);
      return {
        "code": 500,
        "message": "Database error occurred"
      };
    }

    // Validation du mot de passe
    if (!User.testPasswordRegex(_password)) {
      return {
        "code": 400,
        "message": "Your password must contain at least 8 characters, including at least one lowercase letter, one uppercase letter, one digit, and one special character"
      }
    }

    // Vérification que les mots de passe correspondent
    if (_password !== _repassword) {
      return {
        "code": 400,
        "message": "Passwords don't match"
      }
    }

    try {
      return await User.createNew(_name, _email, _password, _role);
    } catch (error) {
      console.error("Error creating user:", error);
      return {
        "code": 500,
        "message": "Failed to create user"
      };
    }
  }

  static testPasswordRegex(_password: string): boolean {
    if (!_password || typeof _password !== 'string') {
      return false;
    }
    
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(_password);
  }

  private static async hashPassword(password: string): Promise<string> {
    const saltRounds = 11;
    try {
      const salt = await bcrypt.genSalt(saltRounds);
      const hashedPassword = await bcrypt.hash(password, salt);
      return hashedPassword;
    } catch (error) {
      throw new Error('Error hashing password');
    }
  }

  static async loginUser(email: string, password: string): Promise<string | null> {
    // Validation des champs requis
    if (!email || typeof email !== 'string') {
      return null;
    }

    if (!password || typeof password !== 'string') {
      return null;
    }

    const secretKey = process.env.JWT_SECRET;
    if (secretKey == undefined) {
      throw new Error("Token cannot be created, contact your admin");
    }

    try {
      const user = await this.findOne({ where: { email: email.trim() } });

      if (!user) {
        return null;
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return null;
      }

      const token = jwt.sign({ userId: user.id, email: user.email, name: user.name, role: user.role }, secretKey, { expiresIn: '1h' });

      return token;
    } catch (error) {
      console.error("Login error:", error);
      return null;
    }
  }

  static getUserFromToken(token: string): { userId: number, email: string, name: string, role: string } | null {
    if (!token || typeof token !== 'string') {
      return null;
    }

    const secretKey = process.env.JWT_SECRET;
    if (secretKey == undefined) {
      throw new Error("Token cannot be created, contact your admin");
    }

    try {
      const decodedToken = jwt.verify(token, secretKey) as { userId: number, email: string, name: string, role: string };
      return decodedToken;
    } catch (error) {
      // En cas d'erreur lors du décodage du token
      return null;
    }
  }
}