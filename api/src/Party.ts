import {
  BaseEntity,
  Column,
  Entity,
  ManyToOne,
  ManyToMany,
  JoinTable,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "./User";

export enum PartyType {
  SOLO = "solo",
  PRIVATE = "private",
}

export enum PartyStatus {
  WAITING = "waiting",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  DISBANDED = "disbanded"
}

@Entity()
export class Party extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User)
  admin!: User;

  @ManyToMany(() => User)
  @JoinTable({
    name: "party_players", // nom de la table de jointure
    joinColumn: {
      name: "party_id",
      referencedColumnName: "id"
    },
    inverseJoinColumn: {
      name: "user_id",
      referencedColumnName: "id"
    }
  })
  players!: User[];

  @Column()
  code!: string;

  @Column({
    type: "varchar",
    length: 20,
    default: PartyType.PRIVATE,
  })
  type!: PartyType;

  @Column({
    type: "varchar",
    length: 20,
    default: PartyStatus.WAITING,
  })
  status!: PartyStatus;

  @Column({ type: "datetime", default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @Column({ type: "datetime", default: () => "CURRENT_TIMESTAMP" })
  updated_at!: Date;

  // Configuration de jeu pour la party
  @Column({ type: "json", nullable: true })
  game_config!: {
    roundsNumber?: number;
    time?: number;
    map?: string;
    gamemode?: string;
  } | null;

  // Limites de la party
  @Column({ default: 8 })
  max_players!: number;
}