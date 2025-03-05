import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UserDto {
  @ApiProperty({
    description: 'Username',
    example: 'johndoe123',
  })
  @IsString()
  @IsNotEmpty({ message: 'Username is required' })
  username: string;
}
