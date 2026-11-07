export type UserRole = 'customer' | 'admin';

export interface UriUserData {
  id: string;
  name: string;
  email: string;
  role?: UserRole;
  phone?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegistrationData extends LoginCredentials {
  name: string;
  phone?: string;
}

export interface AuthResponse {
  token: string;
  user: UriUserData;
}

export class UriUser implements UriUserData {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role?: UserRole;
  readonly phone?: string;

  constructor(data: UriUserData) {
    this.id = data.id;
    this.name = data.name;
    this.email = data.email;
    this.role = data.role;
    this.phone = data.phone;
  }

  static fromJSON(value: unknown): UriUser {
    if (typeof value !== 'object' || value === null) {
      throw new Error('Invalid user data: expected an object.');
    }

    const data = value as Record<string, unknown>;
    const id = data['id'] ?? data['_id'];
    const role = data['role'];

    if (
      typeof id !== 'string' ||
      typeof data['name'] !== 'string' ||
      typeof data['email'] !== 'string'
    ) {
      throw new Error('Invalid user data: id, name and email are required.');
    }
    if (role !== undefined && role !== 'customer' && role !== 'admin') {
      throw new Error('Invalid user data: unsupported role.');
    }
    if (data['phone'] !== undefined && typeof data['phone'] !== 'string') {
      throw new Error('Invalid user data: phone must be a string.');
    }

    return new UriUser({
      id,
      name: data['name'],
      email: data['email'],
      ...(role === undefined ? {} : { role }),
      ...(data['phone'] === undefined ? {} : { phone: data['phone'] }),
    });
  }
}
