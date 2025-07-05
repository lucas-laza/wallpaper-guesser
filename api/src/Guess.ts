import {
  BaseEntity,
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from "typeorm";
import { User } from "./User";
import { Round } from "./Round";
import { Game } from "./Game";
import { Party } from "./Party";

@Entity()
export class Guess extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, { nullable: false })
  user!: User;

  @ManyToOne(() => Round, { nullable: false })
  round!: Round;

  @ManyToOne(() => Game, { nullable: false })
  game!: Game;

  @ManyToOne(() => Party, { nullable: false })
  party!: Party;

  @Column({ nullable: false })
  country_code!: string;

  @Column({ nullable: false })
  is_correct!: boolean;

  @Column({ type: "int", default: 0 })
  score!: number;

  @CreateDateColumn()
  created_at!: Date;

  // Méthode utilitaire pour calculer le score
  static calculateScore(isCorrect: boolean, timeRemaining?: number): number {
    if (!isCorrect) return 0;
    
    // Score de base pour une réponse correcte
    let baseScore = 1000;
    
    // Bonus basé sur le temps restant (optionnel)
    if (timeRemaining && timeRemaining > 0) {
      const timeBonus = Math.floor(timeRemaining * 10); // 10 points par seconde restante
      baseScore += timeBonus;
    }
    
    return baseScore;
  }
}