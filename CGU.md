# Conditions générales d'utilisation — KAYOR

**Version du 2 novembre 2026.**

> 🔒 **Ce fichier est la version INTERNE. Il ne se publie pas.**
> `.vercelignore` écarte les `*.md`, donc il ne part pas au déploiement — et
> c'est voulu : le **§ 12 ci-dessous énumère les faiblesses du service**
> (sauvegardes non vérifiées, pas de MFA, mot de passe de messagerie fuité).
> Écrit ici, c'est un registre d'honnêteté. Publié, c'est une liste de
> courses pour qui voudrait entrer.
>
> La version publique est **`cgu.html`** : même texte, § 12 retiré, et
> renumérotation en conséquence. Elle ne promet rien de faux — le § 10 n'y
> garantit aucune restauration — sans dire pourquoi. **Toute modification
> doit être reportée dans les deux fichiers.**

> ⚠ **Ce texte n'a pas été relu par un juriste.** Il décrit fidèlement le
> fonctionnement du service, vérifié dans le code et dans la base. Sa portée
> juridique au Sénégal — loi n° 2008-12 sur la protection des données à
> caractère personnel, déclaration auprès de la Commission de Protection des
> Données Personnelles (CDP) — doit être validée par un avocat avant d'être
> opposée à une boutique cliente. Le § 12 liste ce que ce texte ne peut pas
> encore garantir sincèrement.

---

## 1. Qui est qui

Trois rôles, à ne pas confondre — c'est ce qui détermine qui répond de quoi.

| | |
|---|---|
| **L'éditeur** | la personne physique ou morale qui exploite KAYOR et qui vous donne accès au service. |
| **La boutique** | la bijouterie abonnée. Elle enregistre ses ventes, ses clientes, son stock. **C'est elle qui décide des données qu'elle saisit** et à quelle fin. |
| **La cliente finale** | la personne qui achète un bijou dans cette bijouterie, et dont le nom, le téléphone et l'épargne figurent dans l'application. Elle n'est pas cliente de l'éditeur. |

**La boutique est responsable des données de ses clientes ; l'éditeur n'en
est que le dépositaire technique.** L'éditeur ne consulte pas ces données, ne
les exploite pas, ne les revend pas, et n'en tire aucun usage statistique.
Cette séparation n'est pas une déclaration d'intention : elle est appliquée
par la base elle-même (§ 5).

## 2. Ce que fait le service

KAYOR est une application de gestion de bijouterie accessible par navigateur.
Elle permet d'enregistrer des ventes, des achats à la clientèle, un stock, une
caisse, des comptes d'épargne-bijoux, et d'imprimer des factures.

Elle comprend également :

- un **portail cliente**, où une cliente consulte son épargne et ses
  commandes au moyen de son numéro de téléphone et d'un code à quatre
  chiffres que la boutique lui attribue ;
- une **vitrine publique**, page accessible à tous, où la boutique publie son
  nom, ses coordonnées, ses horaires et ses réseaux sociaux.

Le service ne traite **aucun paiement en ligne** et n'est pas un
établissement de paiement. Les sommes inscrites dans l'application sont le
reflet d'espèces reçues au comptoir par la boutique ; l'éditeur ne détient
jamais d'argent.

## 3. Abonnement, essai, échéance

L'accès est soumis à un abonnement dont le plan et la date d'échéance sont
fixés par l'éditeur. Les plans existants sont : **essai**, **standard**,
**pro** et **entreprise**.

À l'échéance, ou en cas de suspension, **la boutique passe en lecture
seule** : elle consulte et imprime l'intégralité de son historique, mais ne
peut plus rien enregistrer. Cette bascule est appliquée par la base de
données à chaque requête, et non par l'interface.

Aucune donnée n'est effacée du fait d'une échéance. Elle le reste jusqu'à une
suppression demandée (§ 8).

## 4. Comptes et mots de passe

La propriétaire de la boutique reçoit un identifiant et un mot de passe. Elle
crée elle-même les comptes de son équipe et peut les remplacer à tout moment.

- **Un mot de passe n'est jamais lisible, par personne — éditeur compris.**
  Il est haché et ne peut être que remplacé.
- Tout mot de passe est confronté à une base publique de fuites connues avant
  d'être accepté. Si ce service tiers ne répond pas, le mot de passe est
  accepté : le nombre minimum de caractères reste le verrou.
- **Chaque compte est personnel.** Le partage d'un identifiant entre
  plusieurs personnes rend toute traçabilité illusoire et engage la boutique.
- La boutique signale sans délai tout accès qu'elle suspecte compromis.

Les connexions sont consignées. **Ces traces ne peuvent être ni modifiées ni
effacées, par personne** — c'est volontaire, et c'est aussi ce qui protège la
boutique en cas de litige interne.

## 5. Étanchéité entre boutiques

Les données d'une boutique ne sont accessibles qu'à ses propres membres. Le
cloisonnement est appliqué par la base de données sur chaque lecture et
chaque écriture, et non par l'interface.

**L'éditeur, en tant qu'exploitant du service, n'a pas accès aux données
commerciales d'une boutique.** Son compte d'administration ne peut ni lire
les ventes, ni la caisse, ni les clientes d'une bijouterie. Un dépannage se
fait par téléphone avec la propriétaire, qui regarde son écran.

L'éditeur conserve un accès technique à l'infrastructure (hébergement, base
de données) nécessaire à l'exploitation, aux sauvegardes et à la correction
d'anomalies. Cet accès n'est utilisé qu'à ces fins.

## 6. Portail cliente

La boutique attribue à une cliente, si celle-ci le souhaite, un code à quatre
chiffres lui donnant accès à son épargne et à ses commandes.

- La boutique informe sa cliente de cet accès et recueille son accord.
- Le code est haché et **la boutique elle-même ne peut pas le relire** ; elle
  peut seulement le remplacer.
- Les tentatives d'accès sont limitées et consignées, pour empêcher qu'un
  tiers devine le code d'une cliente.
- Le numéro de téléphone n'est **jamais consigné en clair** dans le journal
  des tentatives : seules une empreinte et les quatre derniers chiffres le
  sont, pour qu'un humain reconnaisse sa cliente sans constituer de fichier.

La cliente peut demander à la boutique le retrait de son accès, la
rectification ou la suppression de ses données. **Cette demande s'adresse à
la bijouterie, pas à l'éditeur** : c'est elle qui détient la relation.

## 7. Vitrine publique

La boutique choisit librement ce qu'elle publie sur sa vitrine. Elle garantit
qu'elle dispose des droits sur les images qu'elle y dépose, et qu'aucune n'y
expose une personne sans son accord.

Aucune donnée de cliente, aucune vente, aucun montant n'apparaît sur cette
page : la fonction qui l'alimente n'expose que les champs d'identité de la
boutique, énumérés un à un.

**Transfert vers un tiers.** Lorsque la boutique renseigne ses coordonnées
GPS, la vitrine affiche une carte fournie par **Google Maps**. Ouvrir cette
page transmet alors à Google l'adresse IP de la visiteuse. La carte n'est
chargée que si la visiteuse fait défiler la page jusqu'à elle, et l'origine
de la visite lui est masquée. C'est le seul élément du service hébergé hors
de son propre domaine ; la boutique peut le retirer en effaçant ses
coordonnées GPS.

## 8. Suppression d'une boutique

La suppression efface définitivement l'historique commercial de la boutique.
Elle est irréversible et ne peut être demandée que par la propriétaire.

Elle est **refusée par le service** tant que :

- une cliente détient de l'épargne dans la boutique — cet argent ne lui a pas
  été rendu ;
- une vente comporte un reste dû — c'est la preuve d'une créance.

Ces deux refus protègent des tiers et ne sont levés par personne, éditeur
compris. La boutique solde ces positions avant de demander la suppression.

## 9. Ce qui n'est pas permis

- Contourner ou tenter de contourner les contrôles d'accès, y compris ceux
  qui limitent le rôle d'un membre de l'équipe.
- Utiliser le service pour enregistrer des opérations fictives, ou pour tenir
  une comptabilité destinée à tromper un tiers ou une administration.
- Extraire massivement les données d'une autre boutique, ou tenter d'y
  accéder.
- Revendre l'accès au service, ou le mettre à disposition d'une bijouterie
  non abonnée.

L'éditeur peut suspendre sans préavis un accès manifestement utilisé en
violation de ce paragraphe.

## 10. Disponibilité et sauvegardes

L'éditeur met en œuvre les moyens raisonnables pour maintenir le service
accessible, **sans engagement de disponibilité chiffré**. Le service dépend
d'un hébergeur tiers, dont les interruptions ne sont pas du ressort de
l'éditeur.

L'application fonctionne dans un navigateur, sans installation. Une connexion
internet est nécessaire.

> **L'état réel des sauvegardes est décrit au § 12.** Aucune garantie de
> restauration n'est donnée dans ce texte tant que ce point n'est pas réglé.

## 11. Responsabilité

Le service est un outil d'enregistrement. **Les écritures sont saisies par la
boutique et relèvent de sa seule responsabilité** : exactitude des montants,
des poids, des identités, conformité fiscale et comptable.

L'éditeur ne répond pas des pertes d'exploitation, du manque à gagner, ni des
conséquences d'une saisie erronée, d'une perte de mot de passe ou d'un partage
de compte. Il répond des défaillances du service qui lui sont directement
imputables, dans la limite des sommes effectivement versées par la boutique
au titre des douze derniers mois.

## 12. Ce que ce texte ne peut pas encore garantir

Relevé le 2 novembre 2026. **Chaque point est un engagement à ne pas prendre
avant correction** — promettre dans des CGU ce que le système ne fait pas est
pire que de n'avoir aucune CGU.

- **Les sauvegardes ne sont pas vérifiées.** Un script hebdomadaire existe ;
  son mot de passe d'application n'est pas au format attendu et il échoue
  probablement en silence. **Aucune restauration n'a jamais été testée.**
  Tant que ce n'est pas réglé, le § 10 ne peut rien promettre.
- **L'hébergement est sur une offre gratuite** qui met le projet en veille
  après une semaine sans activité. Une bijouterie fermée dix jours
  retrouverait son application endormie.
- **L'authentification à deux facteurs n'existe pas.** Un mot de passe
  dérobé suffit à entrer.
- **Le mot de passe d'un compte de messagerie a circulé en clair** dans un
  fichier de configuration et n'a pas été changé.
- **La carte de la vitrine transmet des données à Google** (§ 7). Une
  déclaration auprès de la CDP devra en tenir compte.
- **Aucune déclaration CDP n'a été faite.** Le traitement de données
  personnelles de clientes — nom, téléphone, épargne — y est en principe
  soumis au Sénégal.

## 13. Modification et droit applicable

L'éditeur peut modifier ces conditions. Toute modification substantielle est
portée à la connaissance des boutiques abonnées avant son entrée en vigueur.

Ces conditions sont régies par le droit sénégalais. À défaut d'accord
amiable, le litige relève des juridictions compétentes de Dakar.

---

**Contact de l'éditeur** : *(à compléter — raison sociale, NINEA/RCCM,
adresse, email de contact. Une CGU sans éditeur identifiable n'engage
personne.)*
