export interface JwtUser {
  userId: string;
  username: string;
  exp: number;
  iat: number;
}

export interface ApiResponse {
  message: string;
  data?: any;
}
