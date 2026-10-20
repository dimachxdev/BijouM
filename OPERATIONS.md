# Ventes, acomptes et comptes épargne — ce que fait chaque geste

Toutes les opérations possibles, qui peut les faire, et **leur effet sur le
solde net caisse**. Établi le 2026-10-16 en relisant le code, pas de mémoire.

---

## La règle unique

```
Solde net caisse  =  encaissé sur les ventes
                  +  dépôts sur comptes épargne
                  −  décaissements
```

Trois choses à retenir, et tout le reste en découle :

1. **Un dépôt épargne est de l'argent en caisse.** La cliente avance sur un
   futur bijou ; les billets entrent dans le tiroir le jour du versement.
2. **Payer un bijou avec son épargne ne fait rien entrer.** L'argent était
   déjà là depuis le dépôt. Le recompter gonflerait la caisse.
3. **« CA » et « caisse » sont deux chiffres différents.** Le chiffre
   d'affaires exclut les ventes annulées ; la caisse garde leur acompte tant
   qu'aucun remboursement n'est enregistré.

---

## 1. Ventes

| Geste | Qui | Effet sur la caisse |
|---|---|---|
| Nouvelle vente payée entièrement | tous | **+ montant** |
| Nouvelle vente avec restant dû | tous | **+ acompte** seulement |
| Vente réglée sur le compte épargne | tous | **rien** — l'argent est entré au dépôt |
| Vente mixte (épargne + espèces) | tous | **+ la part en espèces** |
| Vente épargne **avec restant dû** | tous | **+ ce qui est versé ce jour** |
| **+ Paiement** (encaisser le restant) | **tous** | **+ montant versé** |
| Modifier une vente | proprio, admin | recalculée |
| **⟲ Rembourser** (annuler) | proprio, admin | **− montant rendu** |
| Supprimer une vente | proprio, admin | **− son acompte** |

### Encaisser un versement : ouvert à toute l'équipe

C'est le geste du comptoir. Une cliente vient verser le reste sur sa commande :
n'importe qui peut l'enregistrer, dans **Arrhes & Commandes**, bouton
**+ Paiement**.

Mais **modifier** une vente — changer le montant, la cliente, la description —
reste réservé aux administrateurs. C'est la même ligne en base : sans une
fonction serveur dédiée (`enregistrer_paiement_vente`), ouvrir l'un
reviendrait à ouvrir l'autre.

### Payer avec l'épargne et laisser le bijou en commande

La cliente a 20 000 F d'épargne et choisit un bijou à 50 000 F. Son solde ne
suffit pas : la fenêtre **« Le solde ne couvre pas tout »** s'ouvre.

Elle peut alors verser ce qu'elle veut — tout, une partie, ou rien. L'écran
annonce la conséquence avant validation :

> Restera dû : **20 000 F** — la vente ira dans « Arrhes & Commandes ».

Ce qui est enregistré, sur un bijou à 50 000 F dont 20 000 F viennent du compte
et 10 000 F sont versés en espèces :

| | |
|---|---|
| Montant | 50 000 F |
| Acompte | 30 000 F (20 000 du compte + 10 000 versés) |
| Restant dû | 20 000 F |
| **Entré en caisse** | **10 000 F** — uniquement l'argent réellement versé |

Le solde du compte tombe à zéro, la vente apparaît dans **Arrhes & Commandes**,
et la cliente complète plus tard avec **+ Paiement**.

### Rembourser : l'acompte reste sur la vente

Quand vous annulez une vente et rendez l'argent, **l'acompte n'est pas effacé**.
C'est voulu : cet argent est bien entré en caisse le jour de la vente. C'est le
**décaissement de remboursement** qui l'en fait ressortir, à sa date réelle.

Effacer l'acompte ferait baisser la caisse deux fois pour un seul
remboursement, et perdrait la trace de l'encaissement d'origine.

> ⚠ **Si vous annulez sans rien rembourser**, l'acompte reste en caisse — ce
> qui est juste si vous l'avez gardé. Mais si vous rendez l'argent de la main à
> la main sans passer par **⟲ Rembourser**, la caisse restera fausse.

### Ventes annulées dans le journal

Elles apparaissent dans la liste, avec un badge rouge **« Annulée »**, le
montant barré et la ligne atténuée. Le filtre de statut permet de les isoler.

L'en-tête le rappelle : `5 ventes · 5 affichées · 1 annulée (hors total)`.
Le « CA (hors annulées) » ne les compte pas ; la caisse, si — tant qu'il n'y a
pas de remboursement.

---

## 2. Comptes épargne

| Geste | Qui | Effet sur la caisse |
|---|---|---|
| Ouvrir un compte + dépôt initial | tous | **+ dépôt** |
| Dépôt au comptoir | tous | **+ dépôt** |
| Dépôt depuis le portail cliente | la cliente | **+ dépôt** ⚠ voir plus bas |
| Retrait = conversion en bijou | via la vente | **rien** |
| **Solder — rendu en espèces** | proprio, admin | **− solde** (décaissement créé) |
| **Solder — converti en bijou** | proprio, admin | **rien** |
| Supprimer le compte | proprio, admin | **− tous ses dépôts** |

### Solder un compte : dire ce que devient l'argent

Le bouton **Solder** apparaît sur la fiche du compte, pour les administrateurs,
quand le solde est positif. Il demande d'abord **ce que devient l'argent**,
parce que les deux cas n'ont pas le même effet :

- **Rendu en espèces** — la cliente reprend ses billets. Ils sortent du
  tiroir : un décaissement est créé automatiquement.
- **Converti en bijou** — l'argent reste en caisse, en règlement du bijou.

L'écran annonce la conséquence avant que vous validiez. Tout se fait en une
seule transaction serveur : mouvement, solde recalé, décaissement éventuel.

### Le solde affiché n'est pas ce qui est entré en caisse

C'est la confusion la plus coûteuse.

- **« Solde disponible »** = ce qu'il reste à dépenser à la cliente.
- **« Dépôts »** dans le calcul de caisse = tout ce qu'elle a versé depuis
  l'ouverture.

L'écart entre les deux, c'est ce qu'elle a déjà converti en bijou. Cet argent
est entré en caisse au dépôt et n'en est jamais ressorti — il reste donc dans
le tiroir, mais il n'est plus à elle.

> **Ne jamais additionner un « solde disponible » dans un calcul de caisse.**

### Annulation d'un retrait

Si une vente payée sur l'épargne est annulée, le retrait doit être rendu à la
cliente. L'écriture porte le type `annulation` : elle **recrédite son compte
sans faire entrer d'argent** dans le tiroir, puisqu'il n'en était jamais sorti.

Seuls les mouvements de type `depot` comptent comme argent entrant.

### ⚠ Les dépôts venus du portail ne sont pas vérifiés

Une cliente peut, depuis son téléphone, déclarer un dépôt qu'elle n'a pas fait.
Il entre dans la caisse comme les autres. Ces mouvements portent la mention
**« Dépôt portail client »** dans l'historique et sur le relevé imprimé.

**À recouper à la main** avec l'argent réellement reçu, jusqu'à l'intégration
d'un paiement en ligne (PayTech ou PayDunya).

---

## 3. Reprises de bijoux

| Geste | Qui | Effet sur la caisse |
|---|---|---|
| Enregistrer une reprise | tous | **rien** |
| **+ Enregistrer** la sortie caisse | proprio, admin | **− prix de reprise** |
| Supprimer une reprise | proprio, admin | — |

**Enregistrer la reprise ne sort pas l'argent.** C'est volontaire : le paiement
à la cliente peut être différé. La colonne **Sortie caisse** montre « + Enregistrer »
tant que le décaissement n'existe pas, et un bandeau signale le total des
reprises payées mais pas encore sorties de la caisse.

Ces deux repères ne s'affichent qu'aux administrateurs — les autres rôles ne
lisent pas les décaissements, donc l'information leur mentirait.

---

## 4. Décaissements

| Geste | Qui | Effet sur la caisse |
|---|---|---|
| Saisir un décaissement | proprio, admin | **− montant** |
| Supprimer un décaissement | proprio, admin | **+ montant** |

Catégories : dépenses fournisseurs, salaires, loyer, électricité, transport,
entretien, remboursement client, frais divers.

L'onglet **et la lecture** sont réservés aux administrateurs : un vendeur qui
interroge l'API reçoit une liste vide.

---

## 5. Les gestes qui font bouger la caisse sans qu'on y pense

À relire avant de chercher une erreur de calcul :

| Ce qu'on fait | Ce que ça fait vraiment |
|---|---|
| Supprimer un compte épargne | efface **tous** ses dépôts → la caisse baisse d'autant |
| Supprimer une vente | efface son acompte → la caisse baisse d'autant |
| Annuler une vente sans rembourser | l'acompte **reste** en caisse |
| Enregistrer une reprise | **ne sort rien** tant que le décaissement n'est pas créé |
| Encaisser un paiement | passe par le serveur, met à jour acompte **et** restant |

---

## 6. Vérifier un solde qui paraît faux

1. **Lire `APP_VERSION`** sous l'écran de connexion. Un chiffre incohérent est
   presque toujours un cache navigateur ou un déploiement en retard.
2. **Lire le détail** affiché à côté du solde, dans le journal comme sur le
   tableau de bord : `(X encaissé + Y dépôts − Z décaissé)`.
3. **Ne pas recalculer avec le CA** : il exclut les ventes annulées, pas la caisse.
4. **Ne pas recalculer avec un solde disponible** : ce n'est pas ce qui est entré.
5. Chercher les **ventes annulées sans remboursement** et les **dépôts portail
   non vérifiés** — ce sont les deux sources d'écart légitime.

---

## Qui peut quoi, en une ligne

| Rôle | Peut |
|---|---|
| **Vendeur** | saisir ventes, clientes, reprises, comptes et dépôts, encaisser un paiement. Ne modifie ni n'efface rien. Ne voit pas la caisse. |
| **Gestionnaire** | idem + stocks + modifier clientes, comptes, reprises, commandes. Ne voit pas la caisse. |
| **Admin** | tout l'opérationnel, modifier et supprimer les ventes, décaissements, sorties, solder un compte, voir la caisse. |
| **Propriétaire** | idem admin + profil boutique + membres. |

La protection réelle est appliquée par PostgreSQL, pas par les boutons —
voir `CLAUDE.md`.

---

## 7. « Ma journée » — la remise de caisse

Onglet visible au **vendeur** et au **gestionnaire**. Il montre ce que la
personne connectée a saisi **aujourd'hui**, et rien d'autre.

| Ce qu'il contient | Ce qu'il ne contient pas |
|---|---|
| Ses ventes du jour | Le solde de caisse de la boutique |
| Ses dépôts épargne du jour | Les décaissements |
| Ses reprises du jour | Le travail de ses collègues |
| L'encaissé par moyen de paiement | Les autres journées |

Le bouton **Imprimer** sort une feuille de remise de caisse, avec deux lignes
de signature — remis par / reçu par.

### Trois exclusions voulues

**Les ventes annulées** n'y figurent pas.

**Les dépôts venus du portail cliente** non plus : ils n'ont pas d'auteur,
personne ne les a encaissés au comptoir. Les compter ferait réclamer à la
vendeuse un argent qui n'est jamais passé entre ses mains.

**Une vente réglée sur l'épargne** n'apporte que son complément. Si une cliente
paie 50 000 F sur son compte et 10 000 F en espèces, la ligne Espèces porte
10 000 F — les 50 000 F étaient dans le tiroir depuis son dépôt.

### Les dépôts ont leur propre ligne

Aucune colonne n'enregistre par quel moyen un dépôt a été versé. Les ranger
d'office en espèces serait une affirmation que la base ne permet pas : ils
restent donc à part.
