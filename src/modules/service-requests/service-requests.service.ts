import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { ServiceRequestMatchesResponseDto } from './dto/service-request-match.dto';
import { CreateServiceRequestDto, UpdateServiceRequestDto } from './dto/service-request.dto';

@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
  ) {}

  async create(userId: string, data: CreateServiceRequestDto) {
    throw new NotImplementedException('Legacy service requests are no longer supported.');
  }

  async findOpen(categoryId?: string) {
    return [];
  }

  async findOne(id: string, viewerId: string) {
    return null;
  }

  async updateRequest(userId: string, id: string, data: UpdateServiceRequestDto) {
    throw new NotImplementedException('Legacy service requests are no longer supported.');
  }

  async cancelRequest(userId: string, id: string) {
    throw new NotImplementedException('Legacy service requests are no longer supported.');
  }

  async findMatches(
    id: string,
    viewerId?: string,
    viewerType?: 'user' | 'provider' | 'admin',
  ): Promise<ServiceRequestMatchesResponseDto | null> {
    return null;
  }

  private getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((earthRadiusKm * c).toFixed(2));
  }

  private estimateArrivalTime(distanceKm: number): string {
    const averageSpeedKmh = 40;
    const minutes = Math.max(5, Math.round((distanceKm / averageSpeedKmh) * 60));
    return `${minutes} minutes`;
  }

  async findMyRequests(userId: string) {
    return [];
  }
}
