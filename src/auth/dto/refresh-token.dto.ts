import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token ',
    example: 'eyj....',
  })
  @IsString()
  @IsNotEmpty({
    message: 'Refresh token is required to obtain a new access token',
  })
  refreshToken: string;
}
